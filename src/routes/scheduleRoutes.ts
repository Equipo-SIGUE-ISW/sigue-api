import { Request, Response, Router } from 'express';
import { execute, query, queryOne } from '../database/db';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';

type Shift = 'MATUTINO' | 'VESPERTINO';

const router = Router();

router.use(authenticate, authorize('ADMIN'));

const inferShift = (time: string): Shift => {
  const [hourStr] = time.split(':');
  const hour = Number(hourStr);
  return hour < 12 ? 'MATUTINO' : 'VESPERTINO';
};

router.get('/', async (_req: Request, res: Response) => {
  const schedules = await query<{
    id: number;
    shift: Shift;
    time: string;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, shift, time, created_at AS createdAt, updated_at AS updatedAt
     FROM schedules ORDER BY time`
  );
  res.json(schedules);
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const schedule = await queryOne<{
    id: number;
    shift: Shift;
    time: string;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, shift, time, created_at AS createdAt, updated_at AS updatedAt
     FROM schedules WHERE id = ?`,
    [id]
  );

  if (!schedule) {
    res.status(404).json({ message: 'Horario no encontrado' });
    return;
  }

  res.json(schedule);
});

router.post('/', async (req: Request, res: Response) => {
  const { time, shift } = req.body as { time?: string; shift?: Shift };
  if (!time) {
    res.status(400).json({ message: 'time es requerido' });
    return;
  }

  const resolvedShift: Shift = shift ?? inferShift(time);

  const existing = await queryOne<{ id: number }>('SELECT id FROM schedules WHERE time = ?', [time]);
  if (existing) {
    res.status(409).json({ message: 'La hora ya está registrada' });
    return;
  }

  const result = await execute(
    `INSERT INTO schedules (shift, time, created_at, updated_at)
     VALUES (?, ?, NOW(), NOW())`,
    [resolvedShift, time]
  );

  const schedule = await queryOne<{
    id: number;
    shift: Shift;
    time: string;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, shift, time, created_at AS createdAt, updated_at AS updatedAt
     FROM schedules WHERE id = ?`,
    [result.insertId]
  );

  res.status(201).json(schedule);
});

router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const { time, shift } = req.body as { time?: string; shift?: Shift };
  if (!time && !shift) {
    res.status(400).json({ message: 'No hay datos para actualizar' });
    return;
  }

  if (time) {
    const duplicate = await queryOne<{ id: number }>('SELECT id FROM schedules WHERE time = ? AND id <> ?', [time, id]);
    if (duplicate) {
      res.status(409).json({ message: 'La hora ya está registrada' });
      return;
    }
  }

  const updates: string[] = [];
  const params: unknown[] = [];
  if (time) {
    updates.push('time = ?');
    params.push(time);
  }

  if (shift) {
    updates.push('shift = ?');
    params.push(shift);
  } else if (time) {
    updates.push('shift = ?');
    params.push(inferShift(time));
  }

  updates.push('updated_at = NOW()');
  params.push(id);
  const result = await execute(`UPDATE schedules SET ${updates.join(', ')} WHERE id = ?`, params);
  if (result.affectedRows === 0) {
    res.status(404).json({ message: 'Horario no encontrado' });
    return;
  }

  const schedule = await queryOne<{
    id: number;
    shift: Shift;
    time: string;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, shift, time, created_at AS createdAt, updated_at AS updatedAt
     FROM schedules WHERE id = ?`,
    [id]
  );

  res.json(schedule);
});

router.delete('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const groups = await query<{ id: number }>('SELECT id FROM groups WHERE schedule_id = ?', [id]);
  if (groups.length) {
    res.status(409).json({ message: 'El horario tiene grupos asociados' });
    return;
  }

  const result = await execute('DELETE FROM schedules WHERE id = ?', [id]);
  if (result.affectedRows === 0) {
    res.status(404).json({ message: 'Horario no encontrado' });
    return;
  }

  res.status(204).send();
});

export default router;
