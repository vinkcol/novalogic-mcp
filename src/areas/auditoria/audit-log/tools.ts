import type { ToolDefinition } from '../../../shared/types.js';
import { query } from '../../../db/client.js';

// ─────────────────────────────────────────────────────────────────────────────
// Schema auto-init
// Runs once per process start. Idempotent — safe to call on every handler.
// ─────────────────────────────────────────────────────────────────────────────
let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  await query(`CREATE SCHEMA IF NOT EXISTS audit`);
  await query(`
    CREATE TABLE IF NOT EXISTS audit.log_entries (
      id              SERIAL PRIMARY KEY,
      slug            TEXT        NOT NULL,
      category        TEXT        NOT NULL,
      severity        TEXT        NOT NULL DEFAULT 'medium',
      title           TEXT        NOT NULL,
      body            TEXT,
      tags            TEXT[]      NOT NULL DEFAULT '{}',
      source          TEXT,
      affected_count  INTEGER,
      status          TEXT        NOT NULL DEFAULT 'open',
      resolution      TEXT,
      metadata        JSONB       NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at     TIMESTAMPTZ,

      CONSTRAINT audit_log_severity_chk  CHECK (severity IN ('critical','high','medium','low','info')),
      CONSTRAINT audit_log_status_chk    CHECK (status   IN ('open','acknowledged','resolved','wont_fix'))
    )
  `);
  await query(`CREATE INDEX IF NOT EXISTS audit_log_slug_idx      ON audit.log_entries (slug)`);
  await query(`CREATE INDEX IF NOT EXISTS audit_log_slug_cat_idx  ON audit.log_entries (slug, category)`);
  await query(`CREATE INDEX IF NOT EXISTS audit_log_slug_st_idx   ON audit.log_entries (slug, status)`);
  await query(`CREATE INDEX IF NOT EXISTS audit_log_created_idx   ON audit.log_entries (created_at DESC)`);
  schemaReady = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
const STATUSES   = ['open', 'acknowledged', 'resolved', 'wont_fix'] as const;

function assertSeverity(v: string) {
  if (!SEVERITIES.includes(v as any))
    throw new Error(`severity must be one of: ${SEVERITIES.join(', ')}`);
}
function assertStatus(v: string) {
  if (!STATUSES.includes(v as any))
    throw new Error(`status must be one of: ${STATUSES.join(', ')}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Tools
// ─────────────────────────────────────────────────────────────────────────────
export const tools: Record<string, ToolDefinition> = {

  // ── ADD ──────────────────────────────────────────────────────────────────
  audit_log_add: {
    description:
      '[Audit Log] Register a new audit finding or anomaly. Use this whenever a data quality issue, reconciliation discrepancy, ETL error, or architectural decision is discovered.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: {
          type: 'string',
          description: 'Tenant slug (e.g. "simora")',
        },
        category: {
          type: 'string',
          description:
            'Finding category. Common values: data_quality, reconciliation, etl, guide_numbers, false_positive, city_normalization, missing_data, duplicate, architectural_decision, pending_action',
        },
        severity: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low', 'info'],
          description: 'Impact severity. Default: medium',
        },
        title: {
          type: 'string',
          description: 'Short one-line summary of the finding',
        },
        body: {
          type: 'string',
          description:
            'Full description: what was found, evidence, affected records, root cause if known',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Free-form tags for grouping (e.g. ["courier", "MAG50001", "2025-12"])',
        },
        source: {
          type: 'string',
          description:
            'Script or process that discovered the finding (e.g. "check_false_positives.py", "01_guide_reconciliation.py")',
        },
        affected_count: {
          type: 'number',
          description: 'Number of rows, records or guides affected',
        },
        metadata: {
          type: 'object',
          description: 'Any extra structured data (SQL snippets, sample rows, counts, etc.)',
        },
      },
      required: ['slug', 'category', 'title'],
    },
    handler: async (args) => {
      await ensureSchema();
      const {
        slug, category, title,
        severity = 'medium',
        body = null,
        tags = [],
        source = null,
        affected_count = null,
        metadata = {},
      } = args as any;

      assertSeverity(severity);

      const r = await query<any>(
        `INSERT INTO audit.log_entries
           (slug, category, severity, title, body, tags, source, affected_count, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [slug, category, severity, title, body, tags, source, affected_count, metadata],
      );
      return { ok: true, entry: r.rows[0] };
    },
  },

  // ── LIST ─────────────────────────────────────────────────────────────────
  audit_log_list: {
    description:
      '[Audit Log] List audit findings for a tenant. Filter by category, severity, status or tag. Results ordered by created_at DESC.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Tenant slug' },
        category: { type: 'string', description: 'Filter by category (exact match)' },
        severity: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low', 'info'],
          description: 'Filter by severity',
        },
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'resolved', 'wont_fix'],
          description: 'Filter by status (default: show all)',
        },
        tag: { type: 'string', description: 'Filter by a single tag (contains)' },
        limit: { type: 'number', description: 'Max rows to return (default 50, max 200)' },
        offset: { type: 'number', description: 'Pagination offset (default 0)' },
      },
      required: ['slug'],
    },
    handler: async (args) => {
      await ensureSchema();
      const { slug, category, severity, status, tag, limit = 50, offset = 0 } = args as any;

      const conditions: string[] = ['slug = $1'];
      const params: any[]        = [slug];
      let   p = 2;

      if (category) { conditions.push(`category = $${p++}`); params.push(category); }
      if (severity) { conditions.push(`severity = $${p++}`); params.push(severity); }
      if (status)   { conditions.push(`status   = $${p++}`); params.push(status);   }
      if (tag)      { conditions.push(`$${p++} = ANY(tags)`); params.push(tag);     }

      const lim = Math.min(Number(limit) || 50, 200);
      params.push(lim, Number(offset) || 0);

      const r = await query<any>(
        `SELECT id, slug, category, severity, title, tags, source, affected_count,
                status, created_at, resolved_at
         FROM audit.log_entries
         WHERE ${conditions.join(' AND ')}
         ORDER BY created_at DESC
         LIMIT $${p++} OFFSET $${p}`,
        params,
      );

      const total = await query<any>(
        `SELECT COUNT(*) AS n FROM audit.log_entries WHERE ${conditions.slice(0, conditions.length - 0).join(' AND ')}`,
        params.slice(0, params.length - 2),
      );

      return {
        entries: r.rows,
        count: r.rows.length,
        total: Number(total.rows[0]?.n ?? 0),
        offset: Number(offset) || 0,
      };
    },
  },

  // ── GET ──────────────────────────────────────────────────────────────────
  audit_log_get: {
    description:
      '[Audit Log] Get full detail of a single audit finding by numeric ID, including body, metadata and resolution.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Finding ID (from audit_log_list)' },
      },
      required: ['id'],
    },
    handler: async (args) => {
      await ensureSchema();
      const r = await query<any>(
        `SELECT * FROM audit.log_entries WHERE id = $1`,
        [(args as any).id],
      );
      if (!r.rows.length) throw new Error(`No entry with id ${(args as any).id}`);
      return { entry: r.rows[0] };
    },
  },

  // ── UPDATE ───────────────────────────────────────────────────────────────
  audit_log_update: {
    description:
      '[Audit Log] Update a finding: change status, add resolution notes, or amend body/severity. Automatically sets resolved_at when status becomes "resolved".',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'number', description: 'Finding ID to update' },
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'resolved', 'wont_fix'],
          description: 'New status',
        },
        resolution: {
          type: 'string',
          description: 'Resolution notes — what was done to fix or dismiss the finding',
        },
        body: { type: 'string', description: 'Updated body text (replaces existing)' },
        severity: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low', 'info'],
          description: 'Updated severity',
        },
        metadata: {
          type: 'object',
          description: 'Merge into existing metadata (shallow merge)',
        },
      },
      required: ['id'],
    },
    handler: async (args) => {
      await ensureSchema();
      const { id, status, resolution, body, severity, metadata } = args as any;

      if (severity) assertSeverity(severity);
      if (status)   assertStatus(status);

      // Build dynamic SET clause
      const sets: string[] = ['updated_at = NOW()'];
      const params: any[]  = [];
      let p = 1;

      if (status !== undefined) {
        sets.push(`status = $${p++}`);
        params.push(status);
        if (status === 'resolved' || status === 'wont_fix') {
          sets.push(`resolved_at = NOW()`);
        }
      }
      if (resolution !== undefined) { sets.push(`resolution = $${p++}`); params.push(resolution); }
      if (body       !== undefined) { sets.push(`body = $${p++}`);       params.push(body); }
      if (severity   !== undefined) { sets.push(`severity = $${p++}`);   params.push(severity); }
      if (metadata   !== undefined) {
        // Shallow merge with existing JSONB
        sets.push(`metadata = metadata || $${p++}::jsonb`);
        params.push(JSON.stringify(metadata));
      }

      if (sets.length === 1) throw new Error('Nothing to update — provide at least one field.');

      params.push(id);
      const r = await query<any>(
        `UPDATE audit.log_entries SET ${sets.join(', ')} WHERE id = $${p} RETURNING *`,
        params,
      );
      if (!r.rows.length) throw new Error(`No entry with id ${id}`);
      return { ok: true, entry: r.rows[0] };
    },
  },

  // ── SUMMARY ──────────────────────────────────────────────────────────────
  audit_log_summary: {
    description:
      '[Audit Log] Statistical summary of audit findings for a tenant: counts by category, by severity and by status. Useful for a quick health overview.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Tenant slug' },
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'resolved', 'wont_fix'],
          description: 'Filter to a specific status (default: all)',
        },
      },
      required: ['slug'],
    },
    handler: async (args) => {
      await ensureSchema();
      const { slug, status } = args as any;

      const cond   = status ? `AND status = '${status}'` : '';

      const [byCategory, bySeverity, byStatus, recent] = await Promise.all([
        query<any>(
          `SELECT category, status, COUNT(*) AS count, SUM(COALESCE(affected_count,0)) AS affected
           FROM audit.log_entries
           WHERE slug = $1 ${cond}
           GROUP BY category, status
           ORDER BY count DESC`,
          [slug],
        ),
        query<any>(
          `SELECT severity, COUNT(*) AS count
           FROM audit.log_entries
           WHERE slug = $1 ${cond}
           GROUP BY severity
           ORDER BY ARRAY_POSITION(ARRAY['critical','high','medium','low','info'], severity)`,
          [slug],
        ),
        query<any>(
          `SELECT status, COUNT(*) AS count
           FROM audit.log_entries
           WHERE slug = $1
           GROUP BY status`,
          [slug],
        ),
        query<any>(
          `SELECT id, category, severity, title, status, created_at
           FROM audit.log_entries
           WHERE slug = $1 ${cond}
           ORDER BY created_at DESC LIMIT 5`,
          [slug],
        ),
      ]);

      const total = byStatus.rows.reduce((acc: number, r: any) => acc + Number(r.count), 0);

      return {
        slug,
        total,
        by_status:   byStatus.rows,
        by_severity: bySeverity.rows,
        by_category: byCategory.rows,
        recent_5:    recent.rows,
      };
    },
  },

  // ── SEARCH ───────────────────────────────────────────────────────────────
  audit_log_search: {
    description:
      '[Audit Log] Full-text search across title, body and tags. Returns matching findings ordered by relevance then date.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'Tenant slug' },
        q: {
          type: 'string',
          description: 'Search query — matched against title, body and tags',
        },
        status: {
          type: 'string',
          enum: ['open', 'acknowledged', 'resolved', 'wont_fix'],
          description: 'Optionally restrict to a status',
        },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: ['slug', 'q'],
    },
    handler: async (args) => {
      await ensureSchema();
      const { slug, q, status, limit = 20 } = args as any;
      const lim = Math.min(Number(limit) || 20, 100);

      const params: any[] = [slug, `%${q}%`, lim];
      const statusCond = status ? `AND status = '${status}'` : '';

      const r = await query<any>(
        `SELECT id, category, severity, title, tags, source, affected_count, status, created_at,
                LEFT(body, 300) AS body_preview
         FROM audit.log_entries
         WHERE slug = $1
           AND (title ILIKE $2 OR body ILIKE $2 OR array_to_string(tags,' ') ILIKE $2)
           ${statusCond}
         ORDER BY created_at DESC
         LIMIT $3`,
        params,
      );

      return { results: r.rows, count: r.rows.length, query: q };
    },
  },
};
