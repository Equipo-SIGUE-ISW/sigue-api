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

const fetchTeacher = async (id: number) => {
  const teacher = await queryOne<{
    id: number;
    user_id: number;
    name: string;
    degree: string;
    email: string;
    username: string;
  }>(
    `SELECT t.id, t.user_id, t.name, t.degree,
            u.email, u.username
     FROM teachers t
     JOIN users u ON u.id = t.user_id
     WHERE t.id = ?`,
    [id]
  );

  if (!teacher) {
    return null;
  }

  const careers = await query<{ careerId: number; name: string }>(
    `SELECT tc.career_id AS careerId, c.name
     FROM teacher_careers tc
     JOIN careers c ON c.id = tc.career_id
     WHERE tc.teacher_id = ?
     ORDER BY c.name`,
    [id]
  );

  const subjects = await query<{
    subjectId: number;
    name: string;
    careerId: number | null;
    careerName: string | null;
  }>(
    `SELECT ts.subject_id AS subjectId, s.name, s.career_id AS careerId, c.name AS careerName
     FROM teacher_subjects ts
     JOIN subjects s ON s.id = ts.subject_id
     LEFT JOIN careers c ON c.id = s.career_id
     WHERE ts.teacher_id = ?
     ORDER BY s.semester, s.name`,
    [id]
  );

  return { ...teacher, careers, subjects };
};

router.get('/', authorize('ADMIN'), async (_req: Request, res: Response) => {
  const teachers = await query<{
    id: number;
    user_id: number;
    name: string;
    degree: string;
    email: string;
    username: string;
  }>(
    `SELECT t.id, t.user_id, t.name, t.degree,
            u.email, u.username
     FROM teachers t
     JOIN users u ON u.id = t.user_id
     ORDER BY t.id DESC`
  );
  res.json(teachers);
});

router.get('/me', async (req: Request, res: Response) => {
  const requester = req.user as TokenPayload;
  const teacher = await queryOne<{ id: number }>('SELECT id FROM teachers WHERE user_id = ?', [requester.id]);
  if (!teacher) {
    res.status(404).json({ message: 'Maestro no encontrado' });
    return;
  }

  const details = await fetchTeacher(teacher.id);
  if (!details) {
    res.status(404).json({ message: 'Maestro no encontrado' });
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
    const teacherOwner = await queryOne<{ id: number }>('SELECT id FROM teachers WHERE id = ? AND user_id = ?', [id, requester.id]);
    if (!teacherOwner) {
      res.status(403).json({ message: 'No cuenta con permisos suficientes' });
      return;
    }
  }

  const teacher = await fetchTeacher(id);
  if (!teacher) {
    res.status(404).json({ message: 'Maestro no encontrado' });
    return;
  }

  res.json(teacher);
});

router.post('/', authorize('ADMIN'), async (req: Request, res: Response) => {
  const { userId, name, degree, careerIds, subjectIds } = req.body as {
    userId?: number;
    name?: string;
    degree?: 'LICENCIATURA' | 'MAESTRIA' | 'DOCTORADO';
    careerIds?: number[];
    subjectIds?: number[];
  };

  if (!userId || !name || !degree) {
    res.status(400).json({ message: 'userId, name y degree son requeridos' });
    return;
  }

  const existing = await queryOne<{ id: number }>('SELECT id FROM teachers WHERE user_id = ?', [userId]);
  if (existing) {
    res.status(409).json({ message: 'El usuario ya está asociado a un maestro' });
    return;
  }

  const user = await queryOne<{ id: number; role: string }>('SELECT id, role FROM users WHERE id = ?', [userId]);
  if (!user || user.role !== 'TEACHER') {
    res.status(400).json({ message: 'El usuario debe tener perfil de maestro' });
    return;
  }

  const teacherId = await runInTransaction(async (conn) => {
    const result = await executeWithConnection(
      conn,
      `INSERT INTO teachers (user_id, name, degree, created_at, updated_at)
       VALUES (?, ?, ?, NOW(), NOW())`,
      [userId, name, degree]
    );
    const createdTeacherId = result.insertId;

    if (Array.isArray(careerIds)) {
      for (const careerId of careerIds) {
        await executeWithConnection(
          conn,
          `INSERT INTO teacher_careers (teacher_id, career_id)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE career_id = VALUES(career_id)`,
          [createdTeacherId, careerId]
        );
      }
    }

    if (Array.isArray(subjectIds)) {
      for (const subjectId of subjectIds) {
        await executeWithConnection(
          conn,
          `INSERT INTO teacher_subjects (teacher_id, subject_id)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE subject_id = VALUES(subject_id)`,
          [createdTeacherId, subjectId]
        );
      }
    }

    return createdTeacherId;
  });

  const teacher = await fetchTeacher(teacherId);
  res.status(201).json(teacher);
});

router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const requester = req.user as TokenPayload;
  const isAdmin = requester.role === 'ADMIN';
  const current = await queryOne<{ user_id: number }>('SELECT user_id FROM teachers WHERE id = ?', [id]);
  if (!current) {
    res.status(404).json({ message: 'Maestro no encontrado' });
    return;
  }

  if (!isAdmin && current.user_id !== requester.id) {
    res.status(403).json({ message: 'No cuenta con permisos suficientes' });
    return;
  }

  const { name, degree, careerIds, subjectIds } = req.body as {
    name?: string;
    degree?: 'LICENCIATURA' | 'MAESTRIA' | 'DOCTORADO';
    careerIds?: number[];
    subjectIds?: number[];
  };

  if (!isAdmin && (careerIds || subjectIds)) {
    res.status(403).json({ message: 'Solo un administrador puede modificar asignaciones' });
    return;
  }

  await runInTransaction(async (conn) => {
    if (name || degree) {
      const updates: string[] = [];
      const params: unknown[] = [];
      if (name) {
        updates.push('name = ?');
        params.push(name);
      }
      if (degree) {
        updates.push('degree = ?');
        params.push(degree);
      }
      if (updates.length) {
        updates.push('updated_at = NOW()');
        params.push(id);
        await executeWithConnection(conn, `UPDATE teachers SET ${updates.join(', ')} WHERE id = ?`, params);
      }
    }

    if (Array.isArray(careerIds)) {
      const currentCareersRows = await queryWithConnection<{ career_id: number }>(
        conn,
        'SELECT career_id FROM teacher_careers WHERE teacher_id = ?',
        [id]
      );
      const currentCareers = currentCareersRows.map((row) => row.career_id);
      const targetCareers = Array.from(new Set(careerIds));

      const toRemove = currentCareers.filter((careerId) => !targetCareers.includes(careerId));
      const toAdd = targetCareers.filter((careerId) => !currentCareers.includes(careerId));

      for (const careerId of toRemove) {
        await executeWithConnection(
          conn,
          'DELETE FROM teacher_careers WHERE teacher_id = ? AND career_id = ?',
          [id, careerId]
        );

        await executeWithConnection(
          conn,
          `DELETE FROM teacher_subjects
           WHERE teacher_id = ? AND subject_id IN (
             SELECT id FROM subjects WHERE career_id = ?
           )`,
          [id, careerId]
        );
      }

      for (const careerId of toAdd) {
        await executeWithConnection(
          conn,
          `INSERT INTO teacher_careers (teacher_id, career_id)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE career_id = VALUES(career_id)`,
          [id, careerId]
        );
      }
    }

    if (Array.isArray(subjectIds)) {
      await executeWithConnection(conn, 'DELETE FROM teacher_subjects WHERE teacher_id = ?', [id]);
      for (const subjectId of subjectIds) {
        await executeWithConnection(
          conn,
          `INSERT INTO teacher_subjects (teacher_id, subject_id)
           VALUES (?, ?)
           ON DUPLICATE KEY UPDATE subject_id = VALUES(subject_id)`,
          [id, subjectId]
        );
      }
    }
  });

  const teacher = await fetchTeacher(id);
  res.json(teacher);
});

router.delete('/:id', authorize('ADMIN'), async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const groups = await query<{ id: number }>('SELECT id FROM groups WHERE teacher_id = ?', [id]);
  if (groups.length) {
    res.status(409).json({ message: 'El maestro tiene grupos asignados' });
    return;
  }

  try {
    await runInTransaction(async (conn) => {
      await executeWithConnection(conn, 'DELETE FROM teacher_subjects WHERE teacher_id = ?', [id]);
      await executeWithConnection(conn, 'DELETE FROM teacher_careers WHERE teacher_id = ?', [id]);
  const result = await executeWithConnection(conn, 'DELETE FROM teachers WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        throw new Error('NOT_FOUND');
      }
    });
    res.status(204).send();
  } catch (error) {
    res.status(404).json({ message: 'Maestro no encontrado' });
  }
});

export default router;
