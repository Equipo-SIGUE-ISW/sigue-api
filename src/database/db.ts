import fs from 'fs';
import { createConnection, createPool, Pool, PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { DB_CONNECTION_LIMIT, DB_HOST, DB_NAME, DB_PASSWORD, DB_PORT, DB_USER, SCHEMA_PATH } from '../config';

let pool: Pool | null = null;

const ensureSchemaFile = (): string => {
  if (!fs.existsSync(SCHEMA_PATH)) {
    throw new Error(`No se encontró el archivo de esquema en ${SCHEMA_PATH}`);
  }
  return fs.readFileSync(SCHEMA_PATH, 'utf-8');
};

const splitStatements = (sql: string): string[] =>
  sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

const ensureDatabaseExists = async (): Promise<void> => {
  const connection = await createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.end();
};

const getPoolInternal = async (): Promise<Pool> => {
  if (!pool) {
    await ensureDatabaseExists();
    pool = createPool({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD,
      database: DB_NAME,
      charset: 'utf8mb4_unicode_ci',
      waitForConnections: true,
      connectionLimit: DB_CONNECTION_LIMIT
    });
  }
  return pool;
};

export const getPool = async (): Promise<Pool> => getPoolInternal();

export const initializeDatabase = async (): Promise<void> => {
  const schema = ensureSchemaFile();
  const statements = splitStatements(schema);
  const poolConnection = await (await getPoolInternal()).getConnection();

  try {
    for (const statement of statements) {
      await poolConnection.query(statement);
    }
  } finally {
    poolConnection.release();
  }
};

export const query = async <T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> => {
  const connection = await getPoolInternal();
  const [rows] = await connection.query<RowDataPacket[]>(sql, params);
  return rows as T[];
};

export const queryOne = async <T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | undefined> => {
  const rows = await query<T>(sql, params);
  return rows[0];
};

export const execute = async (sql: string, params: unknown[] = []): Promise<ResultSetHeader> => {
  const connection = await getPoolInternal();
  const [result] = await connection.execute<ResultSetHeader>(sql, params);
  return result;
};

export const runInTransaction = async <T>(handler: (conn: PoolConnection) => Promise<T>): Promise<T> => {
  const poolConnection = await (await getPoolInternal()).getConnection();
  try {
    await poolConnection.beginTransaction();
    const result = await handler(poolConnection);
    await poolConnection.commit();
    return result;
  } catch (error) {
    await poolConnection.rollback();
    throw error;
  } finally {
    poolConnection.release();
  }
};

export const queryWithConnection = async <T = RowDataPacket>(
  conn: PoolConnection,
  sql: string,
  params: unknown[] = []
): Promise<T[]> => {
  const [rows] = await conn.query<RowDataPacket[]>(sql, params);
  return rows as T[];
};

export const executeWithConnection = async (
  conn: PoolConnection,
  sql: string,
  params: unknown[] = []
): Promise<ResultSetHeader> => {
  const [result] = await conn.execute<ResultSetHeader>(sql, params);
  return result;
};

