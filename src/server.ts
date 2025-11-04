import app from './app';
import { PORT } from './config';
import { initializeDatabase } from './database/db';
import { seedDatabase } from './database/seed';

const bootstrap = async (): Promise<void> => {
  await initializeDatabase();
  await seedDatabase();

  app.listen(PORT, () => {
    console.log(`API escuchando en http://localhost:${PORT}`);
  });
};

bootstrap().catch((error) => {
  console.error('Error al iniciar el servidor', error);
  process.exit(1);
});
