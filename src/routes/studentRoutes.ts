import { Request, Response, Router } from 'express';
import {
  execute,
  executeWithConnection,
  query,
  queryOne,
  queryWithConnection,
  runInTransaction
} from '../database/db';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { TokenPayload } from '../types';

const router = Router();

router.use(authenticate);

const mapStudent = (row: any) => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
  email: row.email,
  status: row.status,
  dateOfBirth: row.date_of_birth,
  careerId: row.career_id,
  careerName: row.career_name,
  subjects: row.subjects ?? []
});

const fetchStudentDetail = async (id: number) => {
  const student = await queryOne(
    `SELECT s.id, s.user_id, s.name, s.status, s.date_of_birth, s.career_id,
            u.email, u.username,
            c.name AS career_name
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN careers c ON c.id = s.career_id
     WHERE s.id = ?`,
    [id]
  );

  if (!student) {
    return null;
  }

  const subjects = await query<{
    subjectId: number;
    name: string;
    semester: number;
    credits: number;
    careerId: number;
  }>(
    `SELECT ss.subject_id AS subjectId,
            sub.name AS name,
            sub.semester,
            sub.credits,
            sub.career_id AS careerId
     FROM student_subjects ss
     JOIN subjects sub ON sub.id = ss.subject_id
     WHERE ss.student_id = ?
     ORDER BY ss.registered_at`,
    [id]
  );

  return { ...mapStudent(student), subjects };
};

router.get('/', authorize('ADMIN'), async (_req: Request, res: Response) => {
  const rows = await query(
    `SELECT s.id, s.user_id, s.name, s.status, s.date_of_birth, s.career_id,
            u.email, u.username,
            c.name AS career_name
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN careers c ON c.id = s.career_id
     ORDER BY s.id DESC`
  );

  res.json(rows.map(mapStudent));
});

router.get('/me', async (req: Request, res: Response) => {
  const requester = req.user as TokenPayload;
  const student = await queryOne<{ id: number }>('SELECT id FROM students WHERE user_id = ?', [requester.id]);
  if (!student) {
    res.status(404).json({ message: 'Alumno no encontrado' });
    return;
  }

  const details = await fetchStudentDetail(student.id);
  if (!details) {
    res.status(404).json({ message: 'Alumno no encontrado' });
    return;
  }

  res.json(details);
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const requester = req.user as TokenPayload;
  if (requester.role !== 'ADMIN') {
    const student = await queryOne('SELECT id FROM students WHERE id = ? AND user_id = ?', [id, requester.id]);
    if (!student) {
      res.status(403).json({ message: 'No cuenta con permisos suficientes' });
      return;
    }
  }

  const details = await fetchStudentDetail(id);

  if (!details) {
    res.status(404).json({ message: 'Alumno no encontrado' });
    return;
  }

  res.json(details);
});

router.post('/', authorize('ADMIN'), async (req: Request, res: Response) => {
  const { userId, name, status, dateOfBirth, careerId } = req.body as {
    userId?: number;
    name?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    dateOfBirth?: string;
    careerId?: number | null;
  };

  if (!userId || !name || !status || !dateOfBirth) {
    res.status(400).json({ message: 'userId, name, status y dateOfBirth son requeridos' });
    return;
  }

  const existing = await queryOne<{ id: number }>('SELECT id FROM students WHERE user_id = ?', [userId]);
  if (existing) {
    res.status(409).json({ message: 'El usuario ya está asociado a un alumno' });
    return;
  }

  const user = await queryOne<{ id: number; role: string }>('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!user || user.role !== 'STUDENT') {
    res.status(400).json({ message: 'El usuario seleccionado debe tener perfil de alumno' });
    return;
  }

  const result = await execute(
    `INSERT INTO students (user_id, name, status, date_of_birth, career_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NOW(), NOW())`,
    [userId, name, status, dateOfBirth, careerId]
  );

  const created = await queryOne(
    `SELECT s.id, s.user_id, s.name, s.status, s.date_of_birth, s.career_id,
            u.email, u.username,
            c.name AS career_name
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN careers c ON c.id = s.career_id
     WHERE s.id = ?`,
    [result.insertId]
  );

  res.status(201).json(mapStudent(created));
});

router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const requester = req.user as TokenPayload;
  const isAdmin = requester.role === 'ADMIN';

  const current = await queryOne<{ user_id: number }>('SELECT user_id FROM students WHERE id = ?', [id]);

  if (!current) {
    res.status(404).json({ message: 'Alumno no encontrado' });
    return;
  }

  if (!isAdmin && current.user_id !== requester.id) {
    res.status(403).json({ message: 'No cuenta con permisos suficientes' });
    return;
  }

  const { name, status, dateOfBirth, careerId, subjects } = req.body as {
    name?: string;
    status?: 'ACTIVE' | 'INACTIVE';
    dateOfBirth?: string;
    careerId?: number | null;
    subjects?: number[];
  };

  if (!isAdmin && (name || status || dateOfBirth || careerId)) {
    res.status(403).json({ message: 'Solo un administrador puede actualizar datos personales' });
    return;
  }

  if (isAdmin) {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (name) {
      updates.push('name = ?');
      params.push(name);
    }
    if (status) {
      updates.push('status = ?');
      params.push(status);
    }
    if (dateOfBirth) {
      updates.push('date_of_birth = ?');
      params.push(dateOfBirth);
    }
    if (careerId !== undefined) {
      updates.push('career_id = ?');
      params.push(careerId ?? null);
    }

    if (updates.length) {
      updates.push('updated_at = NOW()');
      params.push(id);
      await execute(`UPDATE students SET ${updates.join(', ')} WHERE id = ?`, params);
    }
  }

  if (subjects) {
    await runInTransaction(async (conn) => {
      await executeWithConnection(conn, 'DELETE FROM student_subjects WHERE student_id = ?', [id]);
      const uniqueSubjects = Array.from(new Set(subjects));
      for (const subjectId of uniqueSubjects) {
        await executeWithConnection(
          conn,
          `INSERT INTO student_subjects (student_id, subject_id, registered_at)
           VALUES (?, ?, NOW())`,
          [id, subjectId]
        );
      }
    });
  }

  const student = await queryOne(
    `SELECT s.id, s.user_id, s.name, s.status, s.date_of_birth, s.career_id,
            u.email, u.username,
            c.name AS career_name
     FROM students s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN careers c ON c.id = s.career_id
     WHERE s.id = ?`,
    [id]
  );

  const subjectsResult = await query(
    `SELECT ss.subject_id AS subjectId,
            sub.name AS name,
            sub.semester,
            sub.credits,
            sub.career_id AS careerId
     FROM student_subjects ss
     JOIN subjects sub ON sub.id = ss.subject_id
     WHERE ss.student_id = ?`,
    [id]
  );

  res.json({ ...mapStudent(student), subjects: subjectsResult });
});

router.delete('/:id', authorize('ADMIN'), async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  try {
    await runInTransaction(async (conn) => {
      await executeWithConnection(conn, 'DELETE FROM student_subjects WHERE student_id = ?', [id]);
      await executeWithConnection(conn, 'DELETE FROM group_students WHERE student_id = ?', [id]);
  const result = await executeWithConnection(conn, 'DELETE FROM students WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        throw new Error('NOT_FOUND');
      }
    });
    res.status(204).send();
  } catch (error) {
    res.status(404).json({ message: 'Alumno no encontrado' });
  }
});

export default router;
