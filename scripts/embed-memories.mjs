import http from 'http';
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5433'),
  database: process.env.POSTGRES_DB || 'novalogic_mcp',
  user: process.env.POSTGRES_USER || 'novalogic',
  password: process.env.POSTGRES_PASSWORD || 'novalogic_mcp_2024',
});

function getEmbedding(text) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ model: 'nomic-embed-text', prompt: text });
    const req = http.request({
      hostname: process.env.OLLAMA_HOST || 'localhost',
      port: parseInt(process.env.OLLAMA_PORT || '11434'),
      path: '/api/embeddings',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed.embedding);
        } catch (e) {
          reject(new Error('Failed to parse Ollama response: ' + body.slice(0, 200)));
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function main() {
  const { rows } = await pool.query('SELECT id, content FROM memories WHERE embedding IS NULL ORDER BY id');
  console.log(`Found ${rows.length} memories without embeddings`);

  for (const row of rows) {
    try {
      const embedding = await getEmbedding(row.content);
      const vecStr = '[' + embedding.join(',') + ']';
      await pool.query('UPDATE memories SET embedding = $1::vector WHERE id = $2', [vecStr, row.id]);
      console.log(`Embedded #${row.id} (${embedding.length} dims)`);
    } catch (err) {
      console.error(`Failed #${row.id}: ${err.message}`);
    }
  }

  await pool.end();
  console.log('Done');
}

main().catch(console.error);
