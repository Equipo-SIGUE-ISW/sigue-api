import express, { Request, Response } from 'express';
import cors from 'cors';
import 'express-async-errors';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} (${duration}ms)`);
  });
  next();
});

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use(routes);

app.use(errorHandler);

export default app;
