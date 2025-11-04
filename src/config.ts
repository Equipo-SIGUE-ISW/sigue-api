import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

export const PORT = Number(process.env.PORT ?? 4000);
export const JWT_SECRET = process.env.JWT_SECRET ?? 'development-secret';
export const TOKEN_EXPIRATION = process.env.TOKEN_EXPIRATION ?? '8h';
export const SCHEMA_PATH = process.env.SCHEMA_PATH ?? path.resolve(__dirname, '..', '..', '..', 'sql', 'schema.sql');

export const DB_HOST = process.env.DB_HOST ?? 'localhost';
export const DB_PORT = Number(process.env.DB_PORT ?? 3306);
export const DB_USER = process.env.DB_USER ?? 'root';
export const DB_PASSWORD = process.env.DB_PASSWORD ?? '';
export const DB_NAME = process.env.DB_NAME ?? 'school_control';
export const DB_CONNECTION_LIMIT = Number(process.env.DB_CONNECTION_LIMIT ?? 10);
