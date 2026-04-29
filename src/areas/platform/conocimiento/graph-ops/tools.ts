import type { ToolDefinition } from '../../../../shared/types.js';
import { query } from '../../../../db/client.js';

interface GraphRow {
  id: number;
  name: string;
  type: string;
  description: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

interface NodeRow {
  id: number;
  graph_id: number;
  key: string;
  name: string | null;
  type: string | null;
  properties: Record<string, unknown>;
  parent_key: string | null;
  created_at: string;
  updated_at: string;
}

interface EdgeRow {
  id: number;
  graph_id: number;
  from_key: string;
  to_key: string;
  rel_type: string;
  properties: Record<string, unknown>;
  created_at: string;
}

async function getGraphByName(name: string): Promise<GraphRow> {
  const r = await query<GraphRow>('SELECT * FROM graphs WHERE name = $1', [
    name,
  ]);
  if (!r.rows.length) throw new Error(`Graph not found: ${name}`);
  return r.rows[0];
}

const nameProp = {
  type: 'string',
  description: 'Graph name (unique identifier)',
};

export const tools: Record<string, ToolDefinition> = {
  graph_create: {
    description:
      '[Graph Ops] Create a new graph. type: "tree" | "topology" | "knowledge" | "dependency". Fails if name already exists.',
    inputSchema: {
      type: 'object',
      properties: {
        name: nameProp,
        type: {
          type: 'string',
          enum: ['tree', 'topology', 'knowledge', 'dependency'],
        },
        description: { type: 'string' },
        metadata: { type: 'object' },
      },
      required: ['name', 'type'],
    },
    handler: async ({
      name,
      type,
      description,
      metadata,
    }: {
      name: string;
      type: string;
      description?: string;
      metadata?: Record<string, unknown>;
    }) => {
      const r = await query<GraphRow>(
        `INSERT INTO graphs (name, type, description, metadata)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [name, type, description || null, metadata || {}],
      );
      return { graph: r.rows[0] };
    },
  },

  graph_list: {
    description: '[Graph Ops] List all graphs with node/edge counts.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const r = await query(
        `SELECT g.*,
           (SELECT COUNT(*) FROM graph_nodes n WHERE n.graph_id = g.id) AS node_count,
           (SELECT COUNT(*) FROM graph_edges e WHERE e.graph_id = g.id) AS edge_count
         FROM graphs g ORDER BY g.name`,
      );
      return { graphs: r.rows };
    },
  },

  graph_get: {
    description: '[Graph Ops] Get graph metadata + counts.',
    inputSchema: {
      type: 'object',
      properties: { name: nameProp },
      required: ['name'],
    },
    handler: async ({ name }: { name: string }) => {
      const g = await getGraphByName(name);
      const nodes = await query(
        'SELECT COUNT(*)::int AS c FROM graph_nodes WHERE graph_id = $1',
        [g.id],
      );
      const edges = await query(
        'SELECT COUNT(*)::int AS c FROM graph_edges WHERE graph_id = $1',
        [g.id],
      );
      return {
        graph: g,
        node_count: nodes.rows[0].c,
        edge_count: edges.rows[0].c,
      };
    },
  },

  graph_delete: {
    description:
      '[Graph Ops] Delete a graph and all its nodes/edges (cascade).',
    inputSchema: {
      type: 'object',
      properties: { name: nameProp },
      required: ['name'],
    },
    handler: async ({ name }: { name: string }) => {
      const r = await query('DELETE FROM graphs WHERE name = $1', [name]);
      return { deleted: r.rowCount };
    },
  },

  graph_node_upsert: {
    description:
      '[Graph Ops] Create or update a node by (graph, key). Use parent_key for tree graphs.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: nameProp,
        key: { type: 'string', description: 'Stable unique id within the graph' },
        name: { type: 'string' },
        type: { type: 'string', description: 'e.g. "folder", "file", "service"' },
        properties: { type: 'object' },
        parent_key: {
          type: 'string',
          description: 'Parent node key (for tree graphs)',
        },
      },
      required: ['graph', 'key'],
    },
    handler: async ({
      graph,
      key,
      name,
      type,
      properties,
      parent_key,
    }: {
      graph: string;
      key: string;
      name?: string;
      type?: string;
      properties?: Record<string, unknown>;
      parent_key?: string;
    }) => {
      const g = await getGraphByName(graph);
      const r = await query<NodeRow>(
        `INSERT INTO graph_nodes (graph_id, key, name, type, properties, parent_key)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (graph_id, key) DO UPDATE SET
           name = EXCLUDED.name,
           type = EXCLUDED.type,
           properties = EXCLUDED.properties,
           parent_key = EXCLUDED.parent_key,
           updated_at = NOW()
         RETURNING *`,
        [g.id, key, name || null, type || null, properties || {}, parent_key || null],
      );
      return { node: r.rows[0] };
    },
  },

  graph_node_get: {
    description: '[Graph Ops] Get a node by (graph, key).',
    inputSchema: {
      type: 'object',
      properties: { graph: nameProp, key: { type: 'string' } },
      required: ['graph', 'key'],
    },
    handler: async ({ graph, key }: { graph: string; key: string }) => {
      const g = await getGraphByName(graph);
      const r = await query<NodeRow>(
        'SELECT * FROM graph_nodes WHERE graph_id = $1 AND key = $2',
        [g.id, key],
      );
      if (!r.rows.length) return { found: false };
      return { found: true, node: r.rows[0] };
    },
  },

  graph_node_delete: {
    description:
      '[Graph Ops] Delete a node by (graph, key). Does NOT cascade children — reparent or delete them first if needed.',
    inputSchema: {
      type: 'object',
      properties: { graph: nameProp, key: { type: 'string' } },
      required: ['graph', 'key'],
    },
    handler: async ({ graph, key }: { graph: string; key: string }) => {
      const g = await getGraphByName(graph);
      const r = await query(
        'DELETE FROM graph_nodes WHERE graph_id = $1 AND key = $2',
        [g.id, key],
      );
      return { deleted: r.rowCount };
    },
  },

  graph_edge_upsert: {
    description: '[Graph Ops] Create or update an edge (from -> to) with rel_type.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: nameProp,
        from: { type: 'string', description: 'Source node key' },
        to: { type: 'string', description: 'Target node key' },
        rel_type: { type: 'string', description: 'Default "relates_to"' },
        properties: { type: 'object' },
      },
      required: ['graph', 'from', 'to'],
    },
    handler: async ({
      graph,
      from,
      to,
      rel_type,
      properties,
    }: {
      graph: string;
      from: string;
      to: string;
      rel_type?: string;
      properties?: Record<string, unknown>;
    }) => {
      const g = await getGraphByName(graph);
      const r = await query<EdgeRow>(
        `INSERT INTO graph_edges (graph_id, from_key, to_key, rel_type, properties)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (graph_id, from_key, to_key, rel_type) DO UPDATE SET
           properties = EXCLUDED.properties
         RETURNING *`,
        [g.id, from, to, rel_type || 'relates_to', properties || {}],
      );
      return { edge: r.rows[0] };
    },
  },

  graph_edge_delete: {
    description: '[Graph Ops] Delete an edge.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: nameProp,
        from: { type: 'string' },
        to: { type: 'string' },
        rel_type: { type: 'string' },
      },
      required: ['graph', 'from', 'to'],
    },
    handler: async ({
      graph,
      from,
      to,
      rel_type,
    }: {
      graph: string;
      from: string;
      to: string;
      rel_type?: string;
    }) => {
      const g = await getGraphByName(graph);
      const r = await query(
        `DELETE FROM graph_edges
         WHERE graph_id = $1 AND from_key = $2 AND to_key = $3
           AND rel_type = $4`,
        [g.id, from, to, rel_type || 'relates_to'],
      );
      return { deleted: r.rowCount };
    },
  },

  graph_tree: {
    description:
      '[Graph Ops] Return the hierarchical subtree under a root_key (or full tree if root_key omitted). Uses parent_key. Best for tree-type graphs.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: nameProp,
        root_key: {
          type: 'string',
          description: 'Root node key (optional — defaults to all roots)',
        },
        max_depth: {
          type: 'number',
          description: 'Limit depth (default 10)',
        },
      },
      required: ['graph'],
    },
    handler: async ({
      graph,
      root_key,
      max_depth,
    }: {
      graph: string;
      root_key?: string;
      max_depth?: number;
    }) => {
      const g = await getGraphByName(graph);
      const depth = Math.min(Math.max(max_depth || 10, 1), 50);

      const r = await query<NodeRow>(
        `WITH RECURSIVE tree AS (
           SELECT *, 0 AS depth FROM graph_nodes
           WHERE graph_id = $1 AND ($2::text IS NULL AND parent_key IS NULL OR key = $2)
           UNION ALL
           SELECT n.*, t.depth + 1 FROM graph_nodes n
             JOIN tree t ON n.parent_key = t.key AND n.graph_id = t.graph_id
             WHERE t.depth < $3
         )
         SELECT * FROM tree ORDER BY depth, name`,
        [g.id, root_key || null, depth],
      );

      const byKey = new Map<string, any>();
      const roots: any[] = [];
      for (const row of r.rows) {
        const node = { ...row, children: [] as any[] };
        byKey.set(row.key, node);
      }
      for (const row of r.rows) {
        const node = byKey.get(row.key);
        if (row.parent_key && byKey.has(row.parent_key)) {
          byKey.get(row.parent_key).children.push(node);
        } else {
          roots.push(node);
        }
      }
      return { graph: g.name, total_nodes: r.rows.length, tree: roots };
    },
  },

  graph_query: {
    description:
      '[Graph Ops] Traverse edges from a starting node. Returns neighbors at given depth filtered by rel_type.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: nameProp,
        from: { type: 'string', description: 'Starting node key' },
        rel_type: { type: 'string' },
        depth: { type: 'number', description: 'Default 1, max 5' },
      },
      required: ['graph', 'from'],
    },
    handler: async ({
      graph,
      from,
      rel_type,
      depth,
    }: {
      graph: string;
      from: string;
      rel_type?: string;
      depth?: number;
    }) => {
      const g = await getGraphByName(graph);
      const d = Math.min(Math.max(depth || 1, 1), 5);
      const r = await query(
        `WITH RECURSIVE walk AS (
           SELECT e.*, 1 AS level FROM graph_edges e
           WHERE e.graph_id = $1 AND e.from_key = $2
             AND ($3::text IS NULL OR e.rel_type = $3)
           UNION ALL
           SELECT e.*, w.level + 1 FROM graph_edges e
             JOIN walk w ON e.from_key = w.to_key AND e.graph_id = w.graph_id
             WHERE w.level < $4
               AND ($3::text IS NULL OR e.rel_type = $3)
         )
         SELECT DISTINCT * FROM walk ORDER BY level`,
        [g.id, from, rel_type || null, d],
      );
      return { graph, from, edges: r.rows };
    },
  },

  graph_import_tree: {
    description:
      '[Graph Ops] Bulk upsert nodes. Each item: { key, name?, type?, properties?, parent_key? }. Efficient for populating folder trees, dependency trees, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: nameProp,
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              name: { type: 'string' },
              type: { type: 'string' },
              properties: { type: 'object' },
              parent_key: { type: 'string' },
            },
            required: ['key'],
          },
        },
        clear_first: {
          type: 'boolean',
          description:
            'If true, delete all existing nodes in the graph before import.',
        },
      },
      required: ['graph', 'items'],
    },
    handler: async ({
      graph,
      items,
      clear_first,
    }: {
      graph: string;
      items: Array<{
        key: string;
        name?: string;
        type?: string;
        properties?: Record<string, unknown>;
        parent_key?: string;
      }>;
      clear_first?: boolean;
    }) => {
      const g = await getGraphByName(graph);
      if (clear_first) {
        await query('DELETE FROM graph_nodes WHERE graph_id = $1', [g.id]);
      }
      let inserted = 0;
      for (const item of items) {
        await query(
          `INSERT INTO graph_nodes (graph_id, key, name, type, properties, parent_key)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (graph_id, key) DO UPDATE SET
             name = EXCLUDED.name,
             type = EXCLUDED.type,
             properties = EXCLUDED.properties,
             parent_key = EXCLUDED.parent_key,
             updated_at = NOW()`,
          [
            g.id,
            item.key,
            item.name || null,
            item.type || null,
            item.properties || {},
            item.parent_key || null,
          ],
        );
        inserted++;
      }
      return { graph, imported: inserted };
    },
  },

  graph_nodes_list: {
    description:
      '[Graph Ops] List nodes in a graph with optional filters by type or parent_key.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: nameProp,
        type: { type: 'string' },
        parent_key: { type: 'string' },
        limit: { type: 'number', description: 'Default 100, max 1000' },
      },
      required: ['graph'],
    },
    handler: async ({
      graph,
      type,
      parent_key,
      limit,
    }: {
      graph: string;
      type?: string;
      parent_key?: string;
      limit?: number;
    }) => {
      const g = await getGraphByName(graph);
      const cap = Math.min(Math.max(limit || 100, 1), 1000);
      const conds: string[] = ['graph_id = $1'];
      const params: any[] = [g.id];
      if (type) {
        params.push(type);
        conds.push(`type = $${params.length}`);
      }
      if (parent_key !== undefined) {
        params.push(parent_key);
        conds.push(`parent_key = $${params.length}`);
      }
      params.push(cap);
      const r = await query<NodeRow>(
        `SELECT * FROM graph_nodes WHERE ${conds.join(' AND ')}
         ORDER BY name NULLS LAST LIMIT $${params.length}`,
        params,
      );
      return { graph, count: r.rows.length, nodes: r.rows };
    },
  },
};
