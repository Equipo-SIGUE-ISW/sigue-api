import { Request, Response, Router } from 'express';
import { execute, query, queryOne } from '../database/db';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

const router = Router();

router.use(authenticate, authorize('ADMIN'));

router.get('/', async (_req: Request, res: Response) => {
  const classrooms = await query<{
    id: number;
    name: string;
    building: string;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, name, building, created_at AS createdAt, updated_at AS updatedAt
     FROM classrooms ORDER BY name`
  );
  res.json(classrooms);
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }
  const classroom = await queryOne<{
    id: number;
    name: string;
    building: string;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, name, building, created_at AS createdAt, updated_at AS updatedAt
     FROM classrooms WHERE id = ?`,
    [id]
  );

  if (!classroom) {
    res.status(404).json({ message: 'Salón no encontrado' });
    return;
  }

  res.json(classroom);
});

router.post('/', async (req: Request, res: Response) => {
  const { name, building } = req.body as { name?: string; building?: string };
  if (!name || !building) {
    res.status(400).json({ message: 'name y building son requeridos' });
    return;
  }

  const duplicate = await queryOne<{ id: number }>('SELECT id FROM classrooms WHERE name = ?', [name]);
  if (duplicate) {
    res.status(409).json({ message: 'Ya existe un salón con ese nombre' });
    return;
  }

  const result = await execute(
    `INSERT INTO classrooms (name, building, created_at, updated_at)
     VALUES (?, ?, NOW(), NOW())`,
    [name, building]
  );

  const classroom = await queryOne<{
    id: number;
    name: string;
    building: string;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, name, building, created_at AS createdAt, updated_at AS updatedAt
     FROM classrooms WHERE id = ?`,
    [result.insertId]
  );

  res.status(201).json(classroom);
});

router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const { name, building } = req.body as { name?: string; building?: string };
  if (!name && !building) {
    res.status(400).json({ message: 'No hay datos para actualizar' });
    return;
  }

  if (name) {
    const duplicate = await queryOne<{ id: number }>('SELECT id FROM classrooms WHERE name = ? AND id <> ?', [name, id]);
    if (duplicate) {
      res.status(409).json({ message: 'Ya existe un salón con ese nombre' });
      return;
    }
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  if (name) {
    updates.push('name = ?');
    params.push(name);
  }
  if (building) {
    updates.push('building = ?');
    params.push(building);
  }
  updates.push('updated_at = NOW()');
  params.push(id);

  const result = await execute(`UPDATE classrooms SET ${updates.join(', ')} WHERE id = ?`, params);
  if (result.affectedRows === 0) {
    res.status(404).json({ message: 'Salón no encontrado' });
    return;
  }

  const classroom = await queryOne<{
    id: number;
    name: string;
    building: string;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, name, building, created_at AS createdAt, updated_at AS updatedAt
     FROM classrooms WHERE id = ?`,
    [id]
  );

  res.json(classroom);
});

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }
  const groups = await query<{ id: number }>('SELECT id FROM groups WHERE classroom_id = ?', [id]);
  if (groups.length) {
    res.status(409).json({ message: 'El salón tiene grupos asignados' });
    return;
  }

  const result = await execute('DELETE FROM classrooms WHERE id = ?', [id]);
  if (result.affectedRows === 0) {
    res.status(404).json({ message: 'Salón no encontrado' });
    return;
  }

  res.status(204).send();
});

export default router;
