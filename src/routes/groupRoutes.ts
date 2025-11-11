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

// GET / - listado general (admin) o del maestro autenticado
router.get('/', authorize('ADMIN', 'TEACHER'), async (req: Request, res: Response) => {
  const requester = req.user as TokenPayload;

  let teacherId: number | null = null;
  if (requester.role === 'TEACHER') {
    const teacher = await queryOne<{ id: number }>('SELECT id FROM teachers WHERE user_id = ?', [requester.id]);
    teacherId = teacher?.id ?? null;
    if (!teacherId) {
      res.json([]);
      return;
    }
  }

  const whereClause = teacherId ? 'WHERE g.teacher_id = ?' : '';
  const params = teacherId ? [teacherId] : [];

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
       ${whereClause}
       ORDER BY g.id DESC`,
    params
  );
  res.json(groups.map(mapGroup));
});

// GET /:id - detalle de grupo (admin) o del maestro autenticado
router.get('/:id', authorize('ADMIN', 'TEACHER'), async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }
  const requester = req.user as TokenPayload;

  let teacherId: number | null = null;
  if (requester.role === 'TEACHER') {
    const teacher = await queryOne<{ id: number }>('SELECT id FROM teachers WHERE user_id = ?', [requester.id]);
    teacherId = teacher?.id ?? null;
    if (!teacherId) {
      res.status(403).json({ message: 'No cuenta con permisos suficientes' });
      return;
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

  if (!group) {
    res.status(404).json({ message: 'Grupo no encontrado' });
    return;
  }

  if (teacherId && group.teacher_id !== teacherId) {
    res.status(403).json({ message: 'No cuenta con permisos suficientes' });
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

// POST / - (MODIFICADO CON VALIDACIÓN)
router.post('/', authorize('ADMIN'), async (req: Request, res: Response) => {
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

  // ---
  // --- INICIO DE VALIDACIÓN DE CONFLICTOS (NUEVO) ---
  // ---
  try {
    // 1. Validar nombre de grupo duplicado (para la misma materia)
    const nameConflict = await queryOne('SELECT id FROM groups WHERE name = ? AND subject_id = ?', [name, subjectId]);
    if (nameConflict) {
      res.status(409).json({ message: `Ya existe un grupo con el nombre '${name}' para esta materia.` });
      return;
    }

    // 2. Validar conflicto de Maestro (mismo maestro, mismo horario)
    const teacherConflict = await queryOne(
      'SELECT g.id, t.name FROM groups g JOIN teachers t ON t.id = g.teacher_id WHERE g.teacher_id = ? AND g.schedule_id = ?',
      [teacherId, scheduleId]
    );
    if (teacherConflict) {
      res.status(409).json({ message: `Conflicto de Maestro: ${teacherConflict.name} ya tiene una clase en ese horario.` });
      return;
    }

    // 3. Validar conflicto de Salón (mismo salón, mismo horario)
    const classroomConflict = await queryOne(
      'SELECT g.id, c.name, c.building FROM groups g JOIN classrooms c ON c.id = g.classroom_id WHERE g.classroom_id = ? AND g.schedule_id = ?',
      [classroomId, scheduleId]
    );
    if (classroomConflict) {
      res.status(409).json({ message: `Conflicto de Salón: ${classroomConflict.name} (${classroomConflict.building}) ya está ocupado en ese horario.` });
      return;
    }
  } catch (error) {
    // --- INICIO DE LA CORRECCIÓN (error 'unknown') ---
    let message = 'Error de validación desconocido';
    if (error instanceof Error) {
      message = `Error de validación: ${error.message}`;
    }
    res.status(500).json({ message });
    // --- FIN DE LA CORRECCIÓN ---
    return;
  }
  // ---
  // --- FIN DE VALIDACIÓN DE CONFLICTOS ---
  // ---

  const groupId = await runInTransaction(async (conn) => {
    const result = await executeWithConnection(
      conn,
      `INSERT INTO groups (name, career_id, subject_id, teacher_id, classroom_id, schedule_id, semester, max_students, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [name, careerId, subjectId, teacherId, classroomId, scheduleId, semester, maxStudents]
    );

    // Tu lógica de auto-inscripción (se queda igual)
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
    // Fin de tu lógica

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

// PUT /:id - (MODIFICADO CON VALIDACIÓN)
router.put('/:id', authorize('ADMIN'), async (req: Request<{ id: string }>, res: Response) => {
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

  if (!name || !careerId || !subjectId || !teacherId || !classroomId || !scheduleId || !semester || !maxStudents) {
    res.status(400).json({ message: 'Todos los campos son requeridos para actualizar' });
    return;
  }

  // ---
  // --- INICIO DE VALIDACIÓN DE CONFLICTOS (NUEVO) ---
  // ---
  try {
    // 1. Validar nombre de grupo duplicado (para la misma materia, excluyendo este grupo)
    const nameConflict = await queryOne('SELECT id FROM groups WHERE name = ? AND subject_id = ? AND id <> ?', [name, subjectId, id]);
    if (nameConflict) {
      res.status(409).json({ message: `Ya existe un grupo con el nombre '${name}' para esta materia.` });
      return;
    }

    // 2. Validar conflicto de Maestro (mismo maestro, mismo horario, excluyendo este grupo)
    const teacherConflict = await queryOne(
      'SELECT g.id, t.name FROM groups g JOIN teachers t ON t.id = g.teacher_id WHERE g.teacher_id = ? AND g.schedule_id = ? AND g.id <> ?',
      [teacherId, scheduleId, id]
    );
    if (teacherConflict) {
      res.status(409).json({ message: `Conflicto de Maestro: ${teacherConflict.name} ya tiene una clase en ese horario.` });
      return;
    }

    // 3. Validar conflicto de Salón (mismo salón, mismo horario, excluyendo este grupo)
    const classroomConflict = await queryOne(
      'SELECT g.id, c.name, c.building FROM groups g JOIN classrooms c ON c.id = g.classroom_id WHERE g.classroom_id = ? AND g.schedule_id = ? AND g.id <> ?',
      [classroomId, scheduleId, id]
    );
    if (classroomConflict) {
      res.status(409).json({ message: `Conflicto de Salón: ${classroomConflict.name} (${classroomConflict.building}) ya está ocupado en ese horario.` });
      return;
    }
  } catch (error) {
    // --- INICIO DE LA CORRECCIÓN (error 'unknown') ---
    let message = 'Error de validación desconocido';
    if (error instanceof Error) {
      message = `Error de validación: ${error.message}`;
    }
    res.status(500).json({ message });
    // --- FIN DE LA CORRECCIÓN ---
    return;
  }
  // ---
  // --- FIN DE VALIDACIÓN DE CONFLICTOS ---
  // ---


  const params: unknown[] = [
    name,
    careerId,
    subjectId,
    teacherId,
    classroomId,
    scheduleId,
    semester,
    maxStudents,
    id // para el WHERE
  ];

  const result = await execute(
    `UPDATE groups SET 
      name = ?, career_id = ?, subject_id = ?, teacher_id = ?, 
      classroom_id = ?, schedule_id = ?, semester = ?, max_students = ?, 
      updated_at = NOW()
     WHERE id = ?`,
    params
  );

  if (result.affectedRows === 0) {
    res.status(44).json({ message: 'Grupo no encontrado' });
    return;
  }

  // Tu lógica de reasignación de cupo (se queda igual)
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
  // Fin de tu lógica

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

// DELETE /:id - (SIN CAMBIOS)
router.delete('/:id', authorize('ADMIN'), async (req: Request<{ id: string }>, res: Response) => {
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
