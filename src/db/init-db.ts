import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function initDatabase() {
  const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5433'),
    database: process.env.POSTGRES_DB || 'novalogic_mcp',
    user: process.env.POSTGRES_USER || 'novalogic',
    password: process.env.POSTGRES_PASSWORD || 'novalogic_mcp_2024',
  });

  try {
    const sql = readFileSync(join(__dirname, '../../db/init.sql'), 'utf-8');
    await pool.query(sql);
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

initDatabase();
