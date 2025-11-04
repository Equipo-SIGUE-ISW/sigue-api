import { Request, Response, Router } from 'express';
import { execute, query, queryOne } from '../database/db';
import { authenticate } from '../middleware/auth';
import { authorize } from '../middleware/authorize';
import { hashPassword, hashPasswordSync } from '../utils/password';
import { TokenPayload, UserRole } from '../types';

const router = Router();

router.use(authenticate);

router.get('/', authorize('ADMIN'), async (req: Request, res: Response) => {
  const { search, role } = req.query as { search?: string; role?: UserRole };
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (search) {
    conditions.push('(username LIKE ? OR email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }

  if (role) {
    conditions.push('role = ?');
    params.push(role);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const users = await query<{
    id: number;
    email: string;
    username: string;
    role: UserRole;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, email, username, role, created_at AS createdAt, updated_at AS updatedAt
     FROM users ${whereClause}
     ORDER BY id DESC`,
    params
  );

  res.json(users);
});

router.get('/unassigned', authorize('ADMIN'), async (req: Request, res: Response) => {
  const { role, entity, includeId } = req.query as { role?: UserRole; entity?: string; includeId?: string };
  if (!role || !entity) {
    res.status(400).json({ message: 'role y entity son requeridos' });
    return;
  }

  const includeIdNumber = includeId ? Number(includeId) : undefined;
  if (includeId && Number.isNaN(includeIdNumber)) {
    res.status(400).json({ message: 'includeId inválido' });
    return;
  }

  let table: string;

  switch (entity) {
    case 'students':
      table = 'students';
      break;
    case 'teachers':
      table = 'teachers';
      break;
    default:
      res.status(400).json({ message: 'entity no soportada' });
      return;
  }

  let whereClause = 'WHERE u.role = ? AND (e.user_id IS NULL';
  const params: unknown[] = [role];

  if (includeIdNumber) {
    whereClause += ' OR e.id = ?';
    params.push(includeIdNumber);
  }

  whereClause += ')';

  const users = await query<{ id: number; email: string; username: string }>(
    `SELECT u.id, u.email, u.username
     FROM users u
     LEFT JOIN ${table} e ON e.user_id = u.id
     ${whereClause}
     ORDER BY u.email`,
    params
  );

  res.json(users);
});

router.get('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const requester = req.user as TokenPayload;
  if (requester.role !== 'ADMIN' && requester.id !== id) {
    res.status(403).json({ message: 'No cuenta con permisos suficientes' });
    return;
  }

  const user = await queryOne<{
    id: number;
    email: string;
    username: string;
    role: UserRole;
    createdAt: Date;
    updatedAt: Date;
  }>(
    `SELECT id, email, username, role, created_at AS createdAt, updated_at AS updatedAt
     FROM users WHERE id = ?`,
    [id]
  );

  if (!user) {
    res.status(404).json({ message: 'Usuario no encontrado' });
    return;
  }

  res.json(user);
});

router.post('/', authorize('ADMIN'), async (req: Request, res: Response) => {
  const { email, username, password, role } = req.body as {
    email?: string;
    username?: string;
    password?: string;
    role?: UserRole;
  };

  if (!email || !username || !password || !role) {
    res.status(400).json({ message: 'Todos los campos son requeridos' });
    return;
  }

  const existing = await queryOne<{ id: number }>(
    'SELECT id FROM users WHERE email = ? OR username = ?',
    [email, username]
  );

  if (existing) {
    res.status(409).json({ message: 'El correo o nombre de usuario ya existe' });
    return;
  }

  const hashed = await hashPassword(password);
  const result = await execute(
    `INSERT INTO users (email, username, password, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, NOW(), NOW())`,
    [email, username, hashed, role]
  );

  const user = await queryOne<{
    id: number;
    email: string;
    username: string;
    role: UserRole;
    createdAt: Date;
    updatedAt: Date;
  }>('SELECT id, email, username, role, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ?', [
    result.insertId
  ]);

  res.status(201).json(user);
});

router.put('/:id', async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const requester = req.user as TokenPayload;
  const isSelf = requester.id === id;
  const isAdmin = requester.role === 'ADMIN';

  if (!isAdmin && !isSelf) {
    res.status(403).json({ message: 'No cuenta con permisos suficientes' });
    return;
  }

  const { email, username, password, role } = req.body as {
    email?: string;
    username?: string;
    password?: string;
    role?: UserRole;
  };

  const updates: string[] = [];
  const params: unknown[] = [];

  if (email) {
    if (!isAdmin) {
      res.status(403).json({ message: 'Solo un administrador puede modificar el correo' });
      return;
    }
    updates.push('email = ?');
    params.push(email);
  }

  if (username) {
    updates.push('username = ?');
    params.push(username);
  }

  if (password) {
    updates.push('password = ?');
    params.push(hashPasswordSync(password));
  }

  if (role) {
    if (!isAdmin) {
      res.status(403).json({ message: 'Solo un administrador puede modificar el rol' });
      return;
    }
    updates.push('role = ?');
    params.push(role);
  }

  if (!updates.length) {
    res.status(400).json({ message: 'No hay campos a actualizar' });
    return;
  }

  if (email) {
    const duplicateEmail = await queryOne<{ id: number }>('SELECT id FROM users WHERE email = ? AND id <> ?', [email, id]);
    if (duplicateEmail) {
      res.status(409).json({ message: 'El correo ya existe' });
      return;
    }
  }

  if (username) {
    const duplicateUsername = await queryOne<{ id: number }>('SELECT id FROM users WHERE username = ? AND id <> ?', [username, id]);
    if (duplicateUsername) {
      res.status(409).json({ message: 'El nombre de usuario ya existe' });
      return;
    }
  }

  updates.push('updated_at = NOW()');
  params.push(id);

  const result = await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  if (result.affectedRows === 0) {
    res.status(404).json({ message: 'Usuario no encontrado' });
    return;
  }

  const user = await queryOne<{
    id: number;
    email: string;
    username: string;
    role: UserRole;
    createdAt: Date;
    updatedAt: Date;
  }>(
    'SELECT id, email, username, role, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ?',
    [id]
  );

  res.json(user);
});

router.delete('/:id', authorize('ADMIN'), async (req: Request<{ id: string }>, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: 'ID inválido' });
    return;
  }

  const dependencies = await query<{ tableName: string }>(
    `SELECT 'students' AS tableName FROM students WHERE user_id = ?
     UNION ALL
     SELECT 'teachers' AS tableName FROM teachers WHERE user_id = ?`,
    [id, id]
  );

  if (dependencies.length) {
    res.status(409).json({ message: 'El usuario está asociado a otras entidades y no puede eliminarse' });
    return;
  }

  const result = await execute('DELETE FROM users WHERE id = ?', [id]);

  if (result.affectedRows === 0) {
    res.status(404).json({ message: 'Usuario no encontrado' });
    return;
  }

  res.status(204).send();
});

export default router;
