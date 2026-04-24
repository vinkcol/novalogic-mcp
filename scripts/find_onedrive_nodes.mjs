import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433', 10),
  database: process.env.POSTGRES_DB || 'novalogic_mcp',
  user: process.env.POSTGRES_USER || 'novalogic',
  password: process.env.POSTGRES_PASSWORD || 'novalogic_mcp_2024',
});

function parseArgs(argv) {
  const args = { graph: 'simora-onedrive', q: 'magibell|tienda|ecommerce', limit: 50 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--graph') args.graph = argv[++i] || args.graph;
    else if (a === '--q') args.q = argv[++i] || args.q;
    else if (a === '--limit') args.limit = parseInt(argv[++i] || '50', 10);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  const graph =
    args.graph === 'all'
      ? { id: null, name: 'all', type: 'any' }
      : (await pool.query('SELECT id, name, type FROM graphs WHERE name = $1', [args.graph])).rows[0];
  if (!graph) {
    console.log(JSON.stringify({ graph: args.graph, found: false, nodes: [] }, null, 2));
    await pool.end();
    return;
  }

  const tokens = args.q
    .split('|')
    .map((s) => s.trim())
    .filter(Boolean);
  const patterns = tokens.map((t) => `%${t.toLowerCase()}%`);
  const whereForGraph = patterns
    .map(
      (_, idx) =>
        `(LOWER(COALESCE(key,'')) LIKE $${idx + 2} OR LOWER(COALESCE(name,'')) LIKE $${idx + 2})`,
    )
    .join(' OR ');
  const whereForAll = patterns
    .map(
      (_, idx) =>
        `(LOWER(COALESCE(n.key,'')) LIKE $${idx + 1} OR LOWER(COALESCE(n.name,'')) LIKE $${idx + 1})`,
    )
    .join(' OR ');

  let res;
  if (args.graph === 'all') {
    const sql =
      `SELECT g.name as graph_name, n.id, n.key, n.name, n.type, n.parent_key, n.properties, n.updated_at ` +
      `FROM graph_nodes n JOIN graphs g ON g.id = n.graph_id ` +
      `WHERE (${whereForAll}) ` +
      `ORDER BY n.updated_at DESC NULLS LAST LIMIT $${patterns.length + 1}`;
    res = await pool.query(sql, [...patterns, args.limit]);
  } else {
    const sql =
      `SELECT id, key, name, type, parent_key, properties, updated_at ` +
      `FROM graph_nodes WHERE graph_id = $1 AND (${whereForGraph}) ` +
      `ORDER BY updated_at DESC NULLS LAST LIMIT $${patterns.length + 2}`;
    res = await pool.query(sql, [graph.id, ...patterns, args.limit]);
  }
  console.log(
    JSON.stringify(
      {
        graph,
        query: args.q,
        count: res.rows.length,
        nodes: res.rows,
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
