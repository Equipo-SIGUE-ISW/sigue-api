import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { queryOne } from '../database/db';
import { comparePassword } from '../utils/password';
import { JWT_SECRET, TOKEN_EXPIRATION } from '../config';
import { TokenPayload } from '../types';

const router = Router();

router.post('/login', async (req: Request, res: Response) => {
  const { username, password } = req.body as { username?: string; password?: string };

  if (!username || !password) {
    res.status(400).json({ message: 'Usuario y contraseña son requeridos' });
    return;
  }

  const user = await queryOne<{ id: number; email: string; username: string; password: string; role: TokenPayload['role'] }>(
    `SELECT id, email, username, password, role
     FROM users
     WHERE username = ? OR email = ?`,
    [username, username]
  );

  if (!user) {
    res.status(401).json({ message: 'Credenciales inválidas' });
    return;
  }

  const valid = await comparePassword(password, user.password);
  if (!valid) {
    res.status(401).json({ message: 'Credenciales inválidas' });
    return;
  }

  const payload: TokenPayload = {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role
  };

  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRATION });

  res.json({ token, user: payload });
});

export default router;
