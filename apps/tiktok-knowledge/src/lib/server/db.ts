import { Pool, type PoolClient } from 'pg';

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.PGDATABASE_URL;
    if (!connectionString) throw new Error('PGDATABASE_URL is required');
    pool = new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
    pool.on('error', (error) => console.error('[database] Idle connection failed', error.message));
  }
  return pool;
}

export async function withTransaction<T>(callback: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
