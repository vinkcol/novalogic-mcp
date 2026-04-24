import pg from 'pg';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool({
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5433'),
      database: process.env.POSTGRES_DB || 'novalogic_mcp',
      user: process.env.POSTGRES_USER || 'novalogic',
      password: process.env.POSTGRES_PASSWORD || 'novalogic_mcp_2024',
      max: 10,
    });
  }
  return pool;
}

export async function initDb(): Promise<void> {
  const p = getPool();
  const client = await p.connect();
  try {
    // Verify connection works
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function shutdown(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
