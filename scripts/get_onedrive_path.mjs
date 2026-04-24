import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433', 10),
  database: process.env.POSTGRES_DB || 'novalogic_mcp',
  user: process.env.POSTGRES_USER || 'novalogic',
  password: process.env.POSTGRES_PASSWORD || 'novalogic_mcp_2024',
});

function parseArgs(argv) {
  const args = { graph: 'simora-onedrive', key: null, max: 50 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--graph') args.graph = argv[++i] || args.graph;
    else if (a === '--key') args.key = argv[++i] || null;
    else if (a === '--max') args.max = parseInt(argv[++i] || '50', 10);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.key) {
    console.error('Missing --key');
    process.exit(2);
  }

  const graphRes = await pool.query('SELECT id, name, type FROM graphs WHERE name = $1', [args.graph]);
  const graph = graphRes.rows[0];
  if (!graph) {
    console.log(JSON.stringify({ graph: args.graph, found: false, path: [] }, null, 2));
    await pool.end();
    return;
  }

  const path = [];
  let currentKey = args.key;
  for (let i = 0; i < args.max && currentKey; i++) {
    const res = await pool.query(
      'SELECT id, key, name, type, parent_key, properties, updated_at FROM graph_nodes WHERE graph_id=$1 AND key=$2',
      [graph.id, currentKey],
    );
    const node = res.rows[0];
    if (!node) break;
    path.push({
      key: node.key,
      name: node.name,
      type: node.type,
      parent_key: node.parent_key,
      web_url: node.properties?.web_url,
      child_count: node.properties?.child_count,
      updated_at: node.updated_at,
    });
    currentKey = node.parent_key;
  }

  console.log(
    JSON.stringify(
      {
        graph,
        start_key: args.key,
        depth: path.length,
        path: path.reverse(),
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

