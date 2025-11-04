import { Request, Response, NextFunction } from 'express';
import { UserRole } from '../types';

export const authorize = (...roles: UserRole[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;
    if (!user) {
      res.status(401).json({ message: 'No autenticado' });
      return;
    }

    if (!roles.includes(user.role)) {
      res.status(403).json({ message: 'No cuenta con permisos suficientes' });
      return;
    }

    next();
  };
};
