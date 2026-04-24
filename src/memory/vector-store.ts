import { query } from '../db/client.js';

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const EMBEDDING_DIM = 768;

/**
 * Generate embeddings using Ollama's nomic-embed-text model (768 dimensions).
 * Falls back to a simple hash if Ollama is unavailable.
 */
async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: EMBEDDING_MODEL, prompt: text.slice(0, 8192) }),
    });

    if (!response.ok) {
      throw new Error(`Ollama returned ${response.status}`);
    }

    const data = (await response.json()) as { embedding: number[] };
    return data.embedding;
  } catch (error) {
    console.warn(`[vector-store] Ollama embedding failed, using fallback hash: ${error}`);
    return fallbackHash(text);
  }
}

/** Fallback hash-based embedding when Ollama is unavailable */
function fallbackHash(text: string): number[] {
  const vector = new Array(EMBEDDING_DIM).fill(0);
  const normalized = text.toLowerCase().trim();

  for (let i = 0; i < normalized.length; i++) {
    const char = normalized.charCodeAt(i);
    const idx = (char * (i + 1)) % EMBEDDING_DIM;
    vector[idx] += 1;
    if (i < normalized.length - 1) {
      const bigram = char * 31 + normalized.charCodeAt(i + 1);
      vector[bigram % EMBEDDING_DIM] += 0.5;
    }
    if (i < normalized.length - 2) {
      const trigram = char * 961 + normalized.charCodeAt(i + 1) * 31 + normalized.charCodeAt(i + 2);
      vector[trigram % EMBEDDING_DIM] += 0.25;
    }
  }

  const norm = Math.sqrt(vector.reduce((s, v) => s + v * v, 0)) || 1;
  return vector.map((v) => v / norm);
}

export interface MemoryEntry {
  id?: number;
  agent: string;
  category: string;
  title: string;
  content: string;
  metadata?: Record<string, any>;
  tags?: string[];
}

export interface SearchResult extends MemoryEntry {
  id: number;
  similarity: number;
  access_count: number;
  created_at: Date;
}

export async function storeMemory(entry: MemoryEntry): Promise<number> {
  const embedding = await generateEmbedding(entry.title + ' ' + entry.content);
  const pgVector = `[${embedding.join(',')}]`;

  const result = await query(
    `INSERT INTO memories (agent, category, title, content, metadata, tags, embedding)
     VALUES ($1, $2, $3, $4, $5, $6, $7::vector)
     RETURNING id`,
    [
      entry.agent,
      entry.category,
      entry.title,
      entry.content,
      JSON.stringify(entry.metadata || {}),
      entry.tags || [],
      pgVector,
    ],
  );
  return result.rows[0].id;
}

export async function searchMemory(
  queryText: string,
  options: {
    agent?: string;
    category?: string;
    tags?: string[];
    limit?: number;
  } = {},
): Promise<SearchResult[]> {
  const embedding = await generateEmbedding(queryText);
  const pgVector = `[${embedding.join(',')}]`;
  const limit = options.limit || 10;

  let whereClause = 'WHERE 1=1';
  const params: any[] = [pgVector, limit];
  let paramIdx = 3;

  if (options.agent) {
    whereClause += ` AND agent = $${paramIdx++}`;
    params.push(options.agent);
  }
  if (options.category) {
    whereClause += ` AND category = $${paramIdx++}`;
    params.push(options.category);
  }
  if (options.tags && options.tags.length > 0) {
    whereClause += ` AND tags && $${paramIdx++}`;
    params.push(options.tags);
  }

  const result = await query(
    `SELECT id, agent, category, title, content, metadata, tags,
            1 - (embedding <=> $1::vector) as similarity,
            access_count, created_at
     FROM memories
     ${whereClause}
     ORDER BY embedding <=> $1::vector
     LIMIT $2`,
    params,
  );

  // Update access counts
  if (result.rows.length > 0) {
    const ids = result.rows.map((r: any) => r.id);
    await query(
      `UPDATE memories SET access_count = access_count + 1, last_accessed_at = NOW()
       WHERE id = ANY($1)`,
      [ids],
    );
  }

  return result.rows;
}

export async function searchMemoryByText(
  searchText: string,
  options: { agent?: string; category?: string; limit?: number } = {},
): Promise<SearchResult[]> {
  const limit = options.limit || 10;
  let whereClause = 'WHERE (content ILIKE $1 OR title ILIKE $1)';
  const params: any[] = [`%${searchText}%`, limit];
  let paramIdx = 3;

  if (options.agent) {
    whereClause += ` AND agent = $${paramIdx++}`;
    params.push(options.agent);
  }
  if (options.category) {
    whereClause += ` AND category = $${paramIdx++}`;
    params.push(options.category);
  }

  const result = await query(
    `SELECT id, agent, category, title, content, metadata, tags,
            1.0 as similarity, access_count, created_at
     FROM memories
     ${whereClause}
     ORDER BY updated_at DESC
     LIMIT $2`,
    params,
  );

  return result.rows;
}

export async function updateMemory(
  id: number,
  updates: Partial<MemoryEntry>,
): Promise<void> {
  const sets: string[] = ['updated_at = NOW()'];
  const params: any[] = [];
  let idx = 1;

  if (updates.content !== undefined) {
    sets.push(`content = $${idx++}`);
    params.push(updates.content);
  }
  if (updates.title !== undefined) {
    sets.push(`title = $${idx++}`);
    params.push(updates.title);
  }
  if (updates.category !== undefined) {
    sets.push(`category = $${idx++}`);
    params.push(updates.category);
  }
  if (updates.metadata !== undefined) {
    sets.push(`metadata = $${idx++}`);
    params.push(JSON.stringify(updates.metadata));
  }
  if (updates.tags !== undefined) {
    sets.push(`tags = $${idx++}`);
    params.push(updates.tags);
  }

  // Re-compute embedding if content or title changed
  if (updates.content !== undefined || updates.title !== undefined) {
    const current = await query(
      'SELECT title, content FROM memories WHERE id = $1',
      [id],
    );
    if (current.rows.length > 0) {
      const title = updates.title ?? current.rows[0].title;
      const content = updates.content ?? current.rows[0].content;
      const embedding = await generateEmbedding(title + ' ' + content);
      sets.push(`embedding = $${idx++}::vector`);
      params.push(`[${embedding.join(',')}]`);
    }
  }

  params.push(id);
  await query(
    `UPDATE memories SET ${sets.join(', ')} WHERE id = $${idx}`,
    params,
  );
}

export async function deleteMemory(id: number): Promise<void> {
  await query('DELETE FROM memories WHERE id = $1', [id]);
}

export async function listMemories(
  options: {
    agent?: string;
    category?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<SearchResult[]> {
  let whereClause = 'WHERE 1=1';
  const params: any[] = [];
  let idx = 1;

  if (options.agent) {
    whereClause += ` AND agent = $${idx++}`;
    params.push(options.agent);
  }
  if (options.category) {
    whereClause += ` AND category = $${idx++}`;
    params.push(options.category);
  }

  params.push(options.limit || 50);
  params.push(options.offset || 0);

  const result = await query(
    `SELECT id, agent, category, title, content, metadata, tags,
            1.0 as similarity, access_count, created_at
     FROM memories
     ${whereClause}
     ORDER BY updated_at DESC
     LIMIT $${idx++} OFFSET $${idx}`,
    params,
  );

  return result.rows;
}

export async function getMemoryStats(): Promise<Record<string, any>> {
  const result = await query(`
    SELECT
      agent,
      category,
      COUNT(*) as count,
      MAX(updated_at) as last_updated
    FROM memories
    GROUP BY agent, category
    ORDER BY agent, count DESC
  `);
  return { categories: result.rows };
}
