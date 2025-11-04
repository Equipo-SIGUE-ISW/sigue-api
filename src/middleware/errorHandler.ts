import { NextFunction, Request, Response } from 'express';

export const errorHandler = (error: unknown, _req: Request, res: Response, _next: NextFunction): void => {
  console.error('[API ERROR]', error);

  if (res.headersSent) {
    res.end();
    return;
  }

  res.status(500).json({ message: 'Error interno del servidor' });
};
