import { Request, Response, Router } from 'express';
import { execute, query, queryOne } from '../database/db';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { TokenPayload } from '../types';

const router = Router();

// --- LÍNEA PROBLEMÁTICA ELIMINADA ---
// router.use(authenticate, authorize('ADMIN'));

//
// INICIO DE RUTAS CON PERMISOS INDIVIDUALES
//

// GET / (Ver todas las materias)
// PERMITIDO PARA: ADMIN (para gestionar) y STUDENT (para inscribir)
router.get(
  '/',
  authenticate,
  authorize('ADMIN', 'STUDENT', 'TEACHER'), // <--- Permite lectura a maestros también
  async (req: Request, res: Response) => {
    const { careerId } = req.query as { careerId?: string };
    const requester = req.user as TokenPayload;

    if (requester.role === 'TEACHER') {
      const params: unknown[] = [requester.id];
      let careerFilter = '';
      if (careerId) {
        params.push(Number(careerId));
        careerFilter = 'AND s.career_id = ?';
      }

      const subjects = await query<{
        id: number;
        name: string;
        credits: number;
        semester: number;
        careerId: number | null;
        careerName: string | null;
      }>(
        `SELECT s.id, s.name, s.credits, s.semester, s.career_id AS careerId,
                c.name AS careerName
         FROM teacher_subjects ts
         JOIN teachers t ON t.id = ts.teacher_id
         JOIN subjects s ON s.id = ts.subject_id
         LEFT JOIN careers c ON c.id = s.career_id
         WHERE t.user_id = ?
         ${careerFilter}
         ORDER BY s.semester, s.name`,
        params
      );
      res.json(subjects);
      return;
    }

    const params: unknown[] = [];
    const where = careerId ? 'WHERE s.career_id = ?' : '';
    if (careerId) {
      params.push(Number(careerId));
    }
    const subjects = await query<{
      id: number;
      name: string;
      credits: number;
      semester: number;
      careerId: number;
      careerName: string | null;
    }>(
      `SELECT s.id, s.name, s.credits, s.semester, s.career_id AS careerId,
            c.name AS careerName
       FROM subjects s
       LEFT JOIN careers c ON c.id = s.career_id
       ${where}
       ORDER BY s.semester, s.name`,
      params
    );
    res.json(subjects);
  }
);

// GET /:id (Ver una materia)
// PERMITIDO PARA: ADMIN (para gestionar) y STUDENT (para inscribir)
router.get(
  '/:id',
  authenticate,
  authorize('ADMIN', 'STUDENT', 'TEACHER'), // <--- Permite lectura a maestros también
  async (req: Request<{ id: string }>, res: Response) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'ID inválido' });
      return;
    }

    const requester = req.user as TokenPayload;
    if (requester.role === 'TEACHER') {
      const subject = await queryOne<{
        id: number;
        name: string;
        credits: number;
        semester: number;
        careerId: number | null;
        careerName: string | null;
      }>(
        `SELECT s.id, s.name, s.credits, s.semester, s.career_id AS careerId,
                c.name AS careerName
         FROM teacher_subjects ts
         JOIN teachers t ON t.id = ts.teacher_id
         JOIN subjects s ON s.id = ts.subject_id
         LEFT JOIN careers c ON c.id = s.career_id
         WHERE s.id = ? AND t.user_id = ?`,
        [id, requester.id]
      );

      if (!subject) {
        res.status(403).json({ message: 'No cuenta con permisos suficientes' });
        return;
      }

      res.json(subject);
      return;
    }

    const subject = await queryOne<{
      id: number;
      name: string;
      credits: number;
      semester: number;
      careerId: number;
      careerName: string | null;
    }>(
      `SELECT s.id, s.name, s.credits, s.semester, s.career_id AS careerId,
            c.name AS careerName
       FROM subjects s
       LEFT JOIN careers c ON c.id = s.career_id
       WHERE s.id = ?`,
      [id]
    );
    if (!subject) {
      res.status(404).json({ message: 'Materia no encontrada' });
      return;
    }
    res.json(subject);
  }
);

//
// INICIO DE RUTAS SOLO PARA ADMIN
//

// POST / (Crear materia)
// PERMITIDO PARA: Solo ADMIN
router.post(
  '/',
  authenticate,
  authorize('ADMIN'), // <--- Se mantiene solo ADMIN
  async (req: Request, res: Response) => {
    const { name, credits, semester, careerId } = req.body as {
      name?: string;
      credits?: number;
      semester?: number;
      careerId?: number;
    };

    if (!name || credits === undefined || semester === undefined || !careerId) {
      res.status(400).json({ message: 'Todos los campos son requeridos' });
      return;
    }

    const duplicate = await queryOne<{ id: number }>('SELECT id FROM subjects WHERE name = ? AND career_id = ?', [name, careerId]);
    if (duplicate) {
      res.status(409).json({ message: 'Ya existe la materia en la carrera seleccionada' });
      return;
    }

    const result = await execute(
      `INSERT INTO subjects (name, credits, semester, career_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, NOW(), NOW())`,
      [name, credits, semester, careerId]
    );

    const subject = await queryOne<{
      id: number;
      name: string;
      credits: number;
      semester: number;
      careerId: number;
      careerName: string | null;
    }>(
      `SELECT s.id, s.name, s.credits, s.semester, s.career_id AS careerId,
            c.name AS careerName
       FROM subjects s
       LEFT JOIN careers c ON c.id = s.career_id
       WHERE s.id = ?`,
      [result.insertId]
    );

    res.status(201).json(subject);
  }
);

// PUT /:id (Actualizar materia)
// PERMITIDO PARA: Solo ADMIN
router.put(
  '/:id',
  authenticate,
  authorize('ADMIN'), // <--- Se mantiene solo ADMIN
  async (req: Request<{ id: string }>, res: Response) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'ID inválido' });
      return;
    }

    const { name, credits, semester, careerId } = req.body as {
      name?: string;
      credits?: number;
      semester?: number;
      careerId?: number;
    };

    if (name === undefined && credits === undefined && semester === undefined && careerId === undefined) {
      res.status(400).json({ message: 'No hay campos para actualizar' });
      return;
    }

    if (name && careerId) {
      const duplicate = await queryOne<{ id: number }>(
        'SELECT id FROM subjects WHERE name = ? AND career_id = ? AND id <> ?',
        [name, careerId, id]
      );
      if (duplicate) {
        res.status(409).json({ message: 'Ya existe la materia en la carrera seleccionada' });
        return;
      }
    }

    const updates: string[] = [];
    const params: unknown[] = [];
    if (name) {
      updates.push('name = ?');
      params.push(name);
    }
    if (credits !== undefined) {
      updates.push('credits = ?');
      params.push(credits);
    }
    if (semester !== undefined) {
      updates.push('semester = ?');
      params.push(semester);
    }
    if (careerId !== undefined) {
      updates.push('career_id = ?');
      params.push(careerId);
    }
    updates.push('updated_at = NOW()');
    params.push(id);

    const result = await execute(`UPDATE subjects SET ${updates.join(', ')} WHERE id = ?`, params);
    if (result.affectedRows === 0) {
      res.status(404).json({ message: 'Materia no encontrada' });
      return;
    }

    const subject = await queryOne<{
      id: number;
      name: string;
      credits: number;
      semester: number;
      careerId: number;
      careerName: string | null;
    }>(
      `SELECT s.id, s.name, s.credits, s.semester, s.career_id AS careerId,
            c.name AS careerName
       FROM subjects s
       LEFT JOIN careers c ON c.id = s.career_id
       WHERE s.id = ?`,
      [id]
    );

    res.json(subject);
  }
);

// DELETE /:id (Eliminar materia)
// PERMITIDO PARA: Solo ADMIN
router.delete(
  '/:id',
  authenticate,
  authorize('ADMIN'), // <--- Se mantiene solo ADMIN
  async (req: Request<{ id: string }>, res: Response) => {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: 'ID inválido' });
      return;
    }

    const dependencies = await query<{ tableName: string }>(
      `SELECT 'student_subjects' AS tableName FROM student_subjects WHERE subject_id = ?
       UNION ALL
       SELECT 'teacher_subjects' AS tableName FROM teacher_subjects WHERE subject_id = ?
       UNION ALL
       SELECT 'groups' AS tableName FROM groups WHERE subject_id = ?`,
      [id, id, id]
    );

    if (dependencies.length) {
      res.status(409).json({ message: 'No se puede eliminar la materia porque tiene datos asociados' });
      return;
    }

    const result = await execute('DELETE FROM subjects WHERE id = ?', [id]);
    if (result.affectedRows === 0) {
      res.status(404).json({ message: 'Materia no encontrada' });
      return;
    }

    res.status(204).send();
  }
);

export default router;
