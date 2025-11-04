import express, { Request, Response } from 'express';
import cors from 'cors';
import 'express-async-errors';
import routes from './routes';
import { errorHandler } from './middleware/errorHandler';

const app = express();

app.use(cors());
app.use(express.json());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok' });
});

app.use(routes);

app.use(errorHandler);

export default app;
