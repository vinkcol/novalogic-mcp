import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433', 10),
  database: process.env.POSTGRES_DB || 'novalogic_mcp',
  user: process.env.POSTGRES_USER || 'novalogic',
  password: process.env.POSTGRES_PASSWORD || 'novalogic_mcp_2024',
});

function parseArgs(argv) {
  const args = { limit: 15, keywords: null, id: null, ids: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = parseInt(argv[++i] || '15', 10);
    else if (a === '--keywords') args.keywords = (argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--id') args.id = parseInt(argv[++i] || '', 10);
    else if (a === '--ids') {
      args.ids = (argv[++i] || '')
        .split(',')
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isInteger(n));
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);

  const stats = await pool.query(
    `
      SELECT agent, category, COUNT(*)::int as count, MAX(updated_at) as last_updated
      FROM memories
      GROUP BY agent, category
      ORDER BY agent, count DESC
    `,
  );

  const recent = await pool.query(
    `
      SELECT id, agent, category, title, tags, access_count, updated_at
      FROM memories
      ORDER BY updated_at DESC NULLS LAST
      LIMIT $1
    `,
    [args.limit],
  );

  let matches = null;
  if (args.keywords && args.keywords.length > 0) {
    const patterns = args.keywords.map((k) => `%${k}%`);
    const where = patterns
      .map((_, idx) => `(title ILIKE $${idx + 1} OR content ILIKE $${idx + 1})`)
      .join(' OR ');
    const sql =
      `SELECT id, category, title, tags, updated_at, access_count, LEFT(content, 280) as excerpt ` +
      `FROM memories WHERE ${where} ORDER BY updated_at DESC NULLS LAST LIMIT 25`;
    matches = (await pool.query(sql, patterns)).rows;
  }

  let memory = null;
  if (Number.isInteger(args.id)) {
    const one = await pool.query(
      'SELECT id, agent, category, title, content, tags, updated_at FROM memories WHERE id=$1',
      [args.id],
    );
    memory = one.rows[0] || null;
  }

  let memories = null;
  if (Array.isArray(args.ids) && args.ids.length > 0) {
    const res = await pool.query(
      `
        SELECT id, agent, category, title, content, tags, updated_at, access_count
        FROM memories
        WHERE id = ANY($1)
        ORDER BY updated_at DESC NULLS LAST
      `,
      [args.ids],
    );
    memories = res.rows;
  }

  console.log(
    JSON.stringify(
      {
        stats: stats.rows,
        recent: recent.rows,
        matches,
        memory,
        memories,
      },
      null,
      2,
    ),
  );

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
