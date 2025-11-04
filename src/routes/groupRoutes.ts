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

const router = Router();

router.use(authenticate, authorize('ADMIN'));

const mapGroup = (row: any) => ({
  id: row.id,
  name: row.name,
  careerId: row.career_id,
  careerName: row.career_name,
  subjectId: row.subject_id,
  subjectName: row.subject_name,
  teacherId: row.teacher_id,
  teacherName: row.teacher_name,
  classroomId: row.classroom_id,
  classroomName: row.classroom_name,
  scheduleId: row.schedule_id,
  scheduleTime: row.schedule_time,
  scheduleShift: row.schedule_shift,
  semester: row.semester,
  maxStudents: row.max_students,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

router.get('/', async (_req: Request, res: Response) => {
  const groups = await query(
    `SELECT g.*, c.name AS career_name, sub.name AS subject_name,
            t.name AS teacher_name, cl.name AS classroom_name,
            sc.time AS schedule_time, sc.shift AS schedule_shift
     FROM groups g
     LEFT JOIN careers c ON c.id = g.career_id
     LEFT JOIN subjects sub ON sub.id = g.subject_id
     LEFT JOIN teachers t ON t.id = g.teacher_id
     LEFT JOIN classrooms cl ON cl.id = g.classroom_id
     LEFT JOIN schedules sc ON sc.id = g.schedule_id
     ORDER BY g.id DESC`
  );
  res.json(groups.map(mapGroup));
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }
  const group = await queryOne(
    `SELECT g.*, c.name AS career_name, sub.name AS subject_name,
            t.name AS teacher_name, cl.name AS classroom_name,
            sc.time AS schedule_time, sc.shift AS schedule_shift
     FROM groups g
     LEFT JOIN careers c ON c.id = g.career_id
     LEFT JOIN subjects sub ON sub.id = g.subject_id
     LEFT JOIN teachers t ON t.id = g.teacher_id
     LEFT JOIN classrooms cl ON cl.id = g.classroom_id
     LEFT JOIN schedules sc ON sc.id = g.schedule_id
     WHERE g.id = ?`,
    [id]
  );

  if (!group) {
    res.status(404).json({ message: 'Grupo no encontrado' });
    return;
  }

  const students = await query(
    `SELECT gs.student_id AS studentId, s.name, s.status,
            u.email
     FROM group_students gs
     JOIN students s ON s.id = gs.student_id
     JOIN users u ON u.id = s.user_id
     WHERE gs.group_id = ?
     ORDER BY gs.enrolled_at`,
    [id]
  );

  res.json({ ...mapGroup(group), students });
});

router.post('/', async (req: Request, res: Response) => {
  const { name, careerId, subjectId, teacherId, classroomId, scheduleId, semester, maxStudents } = req.body as {
    name?: string;
    careerId?: number;
    subjectId?: number;
    teacherId?: number;
    classroomId?: number;
    scheduleId?: number;
    semester?: number;
    maxStudents?: number;
  };

  if (!name || !careerId || !subjectId || !teacherId || !classroomId || !scheduleId || !semester || !maxStudents) {
    res.status(400).json({ message: 'Todos los campos son requeridos' });
    return;
  }

  const groupId = await runInTransaction(async (conn) => {
    const result = await executeWithConnection(
      conn,
      `INSERT INTO groups (name, career_id, subject_id, teacher_id, classroom_id, schedule_id, semester, max_students, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [name, careerId, subjectId, teacherId, classroomId, scheduleId, semester, maxStudents]
    );

    const students = await queryWithConnection<{ studentId: number }>(
      conn,
      `SELECT ss.student_id AS studentId
       FROM student_subjects ss
       JOIN students s ON s.id = ss.student_id
       LEFT JOIN (
         SELECT gs.student_id
         FROM group_students gs
         JOIN groups g ON g.id = gs.group_id
         WHERE g.subject_id = ?
       ) AS assigned ON assigned.student_id = ss.student_id
       WHERE ss.subject_id = ?
         AND assigned.student_id IS NULL
       ORDER BY ss.registered_at`,
      [subjectId, subjectId]
    );

    for (const student of students.slice(0, maxStudents)) {
      await executeWithConnection(
        conn,
        `INSERT INTO group_students (group_id, student_id, enrolled_at)
         VALUES (?, ?, NOW())`,
        [result.insertId, student.studentId]
      );
    }

    return result.insertId;
  });

  const group = await queryOne(
    `SELECT g.*, c.name AS career_name, sub.name AS subject_name,
            t.name AS teacher_name, cl.name AS classroom_name,
            sc.time AS schedule_time, sc.shift AS schedule_shift
     FROM groups g
     LEFT JOIN careers c ON c.id = g.career_id
     LEFT JOIN subjects sub ON sub.id = g.subject_id
     LEFT JOIN teachers t ON t.id = g.teacher_id
     LEFT JOIN classrooms cl ON cl.id = g.classroom_id
     LEFT JOIN schedules sc ON sc.id = g.schedule_id
     WHERE g.id = ?`,
    [groupId]
  );

  res.status(201).json(mapGroup(group));
});

router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const { name, careerId, subjectId, teacherId, classroomId, scheduleId, semester, maxStudents } = req.body as {
    name?: string;
    careerId?: number;
    subjectId?: number;
    teacherId?: number;
    classroomId?: number;
    scheduleId?: number;
    semester?: number;
    maxStudents?: number;
  };

  if (!name && !careerId && !subjectId && !teacherId && !classroomId && !scheduleId && !semester && !maxStudents) {
    res.status(400).json({ message: 'No hay datos para actualizar' });
    return;
  }

  const updates: string[] = [];
  const params: unknown[] = [];

  if (name) {
    updates.push('name = ?');
    params.push(name);
  }
  if (careerId) {
    updates.push('career_id = ?');
    params.push(careerId);
  }
  if (subjectId) {
    updates.push('subject_id = ?');
    params.push(subjectId);
  }
  if (teacherId) {
    updates.push('teacher_id = ?');
    params.push(teacherId);
  }
  if (classroomId) {
    updates.push('classroom_id = ?');
    params.push(classroomId);
  }
  if (scheduleId) {
    updates.push('schedule_id = ?');
    params.push(scheduleId);
  }
  if (semester) {
    updates.push('semester = ?');
    params.push(semester);
  }
  if (maxStudents) {
    updates.push('max_students = ?');
    params.push(maxStudents);
  }

  updates.push('updated_at = NOW()');

  params.push(id);
  const result = await execute(`UPDATE groups SET ${updates.join(', ')} WHERE id = ?`, params);

  if (result.affectedRows === 0) {
    res.status(404).json({ message: 'Grupo no encontrado' });
    return;
  }

  if (maxStudents) {
    const assigned = await queryOne<{ count: number }>('SELECT COUNT(*) AS count FROM group_students WHERE group_id = ?', [id]);
    const currentCount = assigned?.count ?? 0;
    if (currentCount > maxStudents) {
      const overflow = currentCount - maxStudents;
      const toRemove = await query<{ student_id: number }>(
        `SELECT student_id FROM group_students
         WHERE group_id = ?
         ORDER BY enrolled_at DESC
         LIMIT ?`,
        [id, overflow]
      );
      for (const row of toRemove) {
        await execute('DELETE FROM group_students WHERE group_id = ? AND student_id = ?', [id, row.student_id]);
      }
    }
  }

  const group = await queryOne(
    `SELECT g.*, c.name AS career_name, sub.name AS subject_name,
            t.name AS teacher_name, cl.name AS classroom_name,
            sc.time AS schedule_time, sc.shift AS schedule_shift
     FROM groups g
     LEFT JOIN careers c ON c.id = g.career_id
     LEFT JOIN subjects sub ON sub.id = g.subject_id
     LEFT JOIN teachers t ON t.id = g.teacher_id
     LEFT JOIN classrooms cl ON cl.id = g.classroom_id
     LEFT JOIN schedules sc ON sc.id = g.schedule_id
     WHERE g.id = ?`,
    [id]
  );

  res.json(mapGroup(group));
});

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  try {
    await runInTransaction(async (conn) => {
      await executeWithConnection(conn, 'DELETE FROM group_students WHERE group_id = ?', [id]);
  const result = await executeWithConnection(conn, 'DELETE FROM groups WHERE id = ?', [id]);
      if (result.affectedRows === 0) {
        throw new Error('NOT_FOUND');
      }
    });
    res.status(204).send();
  } catch (error) {
    res.status(404).json({ message: 'Grupo no encontrado' });
  }
});

export default router;
