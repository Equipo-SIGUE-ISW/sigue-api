import { Request, Response, Router } from 'express';
import { execute, query, queryOne } from '../database/db';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

router.use(authenticate, authorize('ADMIN'));

router.get('/', async (_req: Request, res: Response) => {
  const careers = await query<{
    id: number;
    name: string;
    semesters: number;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, name, semesters, created_at AS createdAt, updated_at AS updatedAt
     FROM careers ORDER BY name`
  );
  res.json(careers);
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }
  const career = await queryOne<{
    id: number;
    name: string;
    semesters: number;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, name, semesters, created_at AS createdAt, updated_at AS updatedAt
     FROM careers WHERE id = ?`,
    [id]
  );

  if (!career) {
    res.status(404).json({ message: 'Carrera no encontrada' });
    return;
  }

  res.json(career);
});

router.post('/', async (req: Request, res: Response) => {
  const { name, semesters } = req.body as { name?: string; semesters?: number };
  if (!name || !semesters || semesters <= 0) {
    res.status(400).json({ message: 'name y semesters son requeridos' });
    return;
  }

  const existing = await queryOne<{ id: number }>('SELECT id FROM careers WHERE name = ?', [name]);
  if (existing) {
    res.status(409).json({ message: 'Ya existe una carrera con ese nombre' });
    return;
  }

  const result = await execute(
    `INSERT INTO careers (name, semesters, created_at, updated_at)
     VALUES (?, ?, NOW(), NOW())`,
    [name, semesters]
  );

  const career = await queryOne<{
    id: number;
    name: string;
    semesters: number;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, name, semesters, created_at AS createdAt, updated_at AS updatedAt
     FROM careers WHERE id = ?`,
    [result.insertId]
  );

  res.status(201).json(career);
});

router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const { name, semesters } = req.body as { name?: string; semesters?: number };
  if (name === undefined && semesters === undefined) {
    res.status(400).json({ message: 'No hay campos para actualizar' });
    return;
  }

  if (name) {
    const duplicate = await queryOne<{ id: number }>('SELECT id FROM careers WHERE name = ? AND id <> ?', [name, id]);
    if (duplicate) {
      res.status(409).json({ message: 'Ya existe una carrera con ese nombre' });
      return;
    }
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  if (name) {
    updates.push('name = ?');
    params.push(name);
  }
  if (semesters !== undefined) {
    if (semesters <= 0) {
      res.status(400).json({ message: 'semesters debe ser mayor a 0' });
      return;
    }
    updates.push('semesters = ?');
    params.push(semesters);
  }

  updates.push('updated_at = NOW()');
  params.push(id);
  const result = await execute(`UPDATE careers SET ${updates.join(', ')} WHERE id = ?`, params);

  if (result.affectedRows === 0) {
    res.status(404).json({ message: 'Carrera no encontrada' });
    return;
  }

  const career = await queryOne<{
    id: number;
    name: string;
    semesters: number;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, name, semesters, created_at AS createdAt, updated_at AS updatedAt
     FROM careers WHERE id = ?`,
    [id]
  );

  res.json(career);
});

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const dependencies = await query<{ tableName: string }>(
    `SELECT 'subjects' AS tableName FROM subjects WHERE career_id = ?
     UNION ALL
     SELECT 'students' AS tableName FROM students WHERE career_id = ?`,
    [id, id]
  );

  if (dependencies.length) {
    res.status(409).json({ message: 'No se puede eliminar la carrera porque tiene elementos asociados' });
    return;
  }

  const result = await execute('DELETE FROM careers WHERE id = ?', [id]);
  if (result.affectedRows === 0) {
    res.status(404).json({ message: 'Carrera no encontrada' });
    return;
  }

  res.status(204).send();
});

export default router;
