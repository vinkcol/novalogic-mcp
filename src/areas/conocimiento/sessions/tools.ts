import { query } from '../../../db/client.js';

// ── helpers ──────────────────────────────────────────────────────────────────

function buildSlug(tenant: string | undefined, title: string, date?: string): string {
  const d = date ?? new Date().toISOString().slice(0, 10);
  const base = (tenant ? `${tenant}-` : '') + d + '-' + title.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 40);
  return base;
}

function formatSession(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    tenant: row.tenant,
    title: row.title,
    focus: row.focus,
    status: row.status,
    context: row.context,
    pending_items: row.pending_items ?? [],
    completed_items: row.completed_items ?? [],
    prior_session_slug: row.prior_session_slug,
    tags: row.tags ?? [],
    metadata: row.metadata ?? {},
    started_at: row.started_at,
    paused_at: row.paused_at,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
  };
}

// ── tools ────────────────────────────────────────────────────────────────────

export const tools = {

  session_start: {
    description: `[Session Manager] Start a new work session or resume the last paused one for a tenant.
Automatically pauses any currently active session. Returns the full session record so you can
immediately recover context. Use at the beginning of every conversation to anchor the session.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant: { type: 'string', description: 'Tenant slug: novalogic | vink | simora (optional for cross-tenant)' },
        title: { type: 'string', description: 'Short title for this session (e.g. "ecommerce-setup", "etl-dim-employees")' },
        focus: { type: 'string', description: 'One-line description of what this session will work on' },
        context: { type: 'string', description: 'Optional initial context or notes to attach' },
        pending_items: {
          type: 'array',
          items: { type: 'object' },
          description: 'Optional initial pending items [{title, priority?}]',
        },
        prior_session_slug: { type: 'string', description: 'Slug of the session this continues (optional)' },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' },
        resume_last: {
          type: 'boolean',
          description: 'If true and a paused session exists for this tenant, resume it instead of creating new (default false)',
        },
      },
      required: ['title'],
    },
    handler: async (args: any) => {
      // Pause any currently active session for this tenant
      const pauseWhere = args.tenant
        ? `tenant = $1 AND status = 'active'`
        : `tenant IS NULL AND status = 'active'`;
      const pauseParams = args.tenant ? [args.tenant] : [];
      await query(
        `UPDATE work_sessions SET status = 'paused', paused_at = NOW(), updated_at = NOW()
         WHERE ${pauseWhere}`,
        pauseParams,
      );

      // If resume_last, find last paused session for tenant
      if (args.resume_last) {
        const whereT = args.tenant
          ? `tenant = $1 AND status = 'paused'`
          : `tenant IS NULL AND status = 'paused'`;
        const resumeResult = await query(
          `UPDATE work_sessions SET status = 'active', paused_at = NULL, updated_at = NOW()
           WHERE id = (
             SELECT id FROM work_sessions WHERE ${whereT} ORDER BY updated_at DESC LIMIT 1
           )
           RETURNING *`,
          args.tenant ? [args.tenant] : [],
        );
        if (resumeResult.rows.length > 0) {
          return { action: 'resumed', session: formatSession(resumeResult.rows[0]) };
        }
      }

      // Create new session
      const slug = buildSlug(args.tenant, args.title);
      const pending = (args.pending_items ?? []).map((item: any, i: number) => ({
        id: i + 1,
        title: typeof item === 'string' ? item : item.title,
        priority: item.priority ?? 'medium',
        done: false,
      }));

      const result = await query(
        `INSERT INTO work_sessions
           (slug, tenant, title, focus, status, context, pending_items, prior_session_slug, tags, metadata)
         VALUES ($1, $2, $3, $4, 'active', $5, $6::jsonb, $7, $8, $9::jsonb)
         RETURNING *`,
        [
          slug,
          args.tenant ?? null,
          args.title,
          args.focus ?? null,
          args.context ?? null,
          JSON.stringify(pending),
          args.prior_session_slug ?? null,
          args.tags ?? [],
          JSON.stringify(args.metadata ?? {}),
        ],
      );

      return { action: 'created', session: formatSession(result.rows[0]) };
    },
  },

  session_recover: {
    description: `[Session Manager] Recover the last active or paused session. Use this at the start of a conversation
to instantly restore context. Returns the full session including pending items, focus, context and prior session link.
If tenant is provided, scoped to that tenant. Otherwise returns the globally most recent session.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant: { type: 'string', description: 'Filter by tenant (optional)' },
        include_prior: { type: 'boolean', description: 'Also include the prior session summary (default false)' },
      },
    },
    handler: async (args: any) => {
      let whereClause = `status IN ('active', 'paused')`;
      const params: any[] = [];
      if (args.tenant) {
        whereClause += ` AND tenant = $${params.length + 1}`;
        params.push(args.tenant);
      }

      const result = await query(
        `SELECT * FROM work_sessions WHERE ${whereClause} ORDER BY updated_at DESC LIMIT 1`,
        params,
      );

      if (result.rows.length === 0) {
        return { found: false, message: 'No active or paused session found.' };
      }

      const session = formatSession(result.rows[0]);
      const response: any = { found: true, session };

      if (args.include_prior && session.prior_session_slug) {
        const prior = await query(
          `SELECT * FROM work_sessions WHERE slug = $1`,
          [session.prior_session_slug],
        );
        if (prior.rows.length > 0) {
          response.prior_session = formatSession(prior.rows[0]);
        }
      }

      // Mark as accessed (update updated_at only if paused, to surface it)
      return response;
    },
  },

  session_update: {
    description: `[Session Manager] Update the current session — add/complete pending items, update focus or context, add notes.
Use throughout a session to keep the state fresh and ensure easy recovery next time.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Session slug to update' },
        focus: { type: 'string', description: 'Update the current focus line' },
        context: { type: 'string', description: 'Append to (or replace) the session context/notes' },
        context_mode: {
          type: 'string',
          enum: ['append', 'replace'],
          description: 'Whether to append context or replace it (default: append)',
        },
        add_pending: {
          type: 'array',
          items: { type: 'object' },
          description: 'New pending items to add [{title, priority?}]',
        },
        complete_pending: {
          type: 'array',
          items: { type: 'number' },
          description: 'IDs of pending items to mark as completed',
        },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' },
      },
      required: ['slug'],
    },
    handler: async (args: any) => {
      const current = await query(`SELECT * FROM work_sessions WHERE slug = $1`, [args.slug]);
      if (current.rows.length === 0) {
        return { success: false, error: `Session '${args.slug}' not found` };
      }

      const row = current.rows[0];
      const sets: string[] = ['updated_at = NOW()'];
      const params: any[] = [];
      let idx = 1;

      if (args.focus !== undefined) {
        sets.push(`focus = $${idx++}`);
        params.push(args.focus);
      }

      if (args.context !== undefined) {
        const mode = args.context_mode ?? 'append';
        if (mode === 'append' && row.context) {
          sets.push(`context = $${idx++}`);
          params.push(row.context + '\n\n---\n\n' + args.context);
        } else {
          sets.push(`context = $${idx++}`);
          params.push(args.context);
        }
      }

      // Handle pending items
      let pending: any[] = row.pending_items ?? [];
      let completed: any[] = row.completed_items ?? [];

      if (args.add_pending && args.add_pending.length > 0) {
        const maxId = pending.length > 0 ? Math.max(...pending.map((p: any) => p.id ?? 0)) : 0;
        const newItems = args.add_pending.map((item: any, i: number) => ({
          id: maxId + i + 1,
          title: typeof item === 'string' ? item : item.title,
          priority: item.priority ?? 'medium',
          done: false,
        }));
        pending = [...pending, ...newItems];
      }

      if (args.complete_pending && args.complete_pending.length > 0) {
        const ids = new Set(args.complete_pending);
        const nowCompleted = pending.filter((p: any) => ids.has(p.id)).map((p: any) => ({ ...p, done: true, completed_at: new Date().toISOString() }));
        pending = pending.filter((p: any) => !ids.has(p.id));
        completed = [...completed, ...nowCompleted];
      }

      sets.push(`pending_items = $${idx++}::jsonb`);
      params.push(JSON.stringify(pending));
      sets.push(`completed_items = $${idx++}::jsonb`);
      params.push(JSON.stringify(completed));

      if (args.tags) {
        sets.push(`tags = $${idx++}`);
        params.push(args.tags);
      }

      if (args.metadata) {
        sets.push(`metadata = metadata || $${idx++}::jsonb`);
        params.push(JSON.stringify(args.metadata));
      }

      params.push(args.slug);
      const result = await query(
        `UPDATE work_sessions SET ${sets.join(', ')} WHERE slug = $${idx} RETURNING *`,
        params,
      );

      return { success: true, session: formatSession(result.rows[0]) };
    },
  },

  session_end: {
    description: `[Session Manager] End a session by marking it as paused or completed.
Use 'paused' when work will continue later. Use 'completed' when the goal is fully done.
Provide a summary to make future recovery faster.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Session slug to end' },
        status: {
          type: 'string',
          enum: ['paused', 'completed'],
          description: 'New status (default: paused)',
        },
        summary: { type: 'string', description: 'Brief summary of what was accomplished' },
        remaining_notes: { type: 'string', description: 'Notes about what is still pending or what to do next session' },
      },
      required: ['slug'],
    },
    handler: async (args: any) => {
      const status = args.status ?? 'paused';
      const tsField = status === 'completed' ? 'completed_at' : 'paused_at';

      const current = await query(`SELECT * FROM work_sessions WHERE slug = $1`, [args.slug]);
      if (current.rows.length === 0) {
        return { success: false, error: `Session '${args.slug}' not found` };
      }

      let newContext = current.rows[0].context ?? '';
      const parts: string[] = [];
      if (args.summary) parts.push(`## Resumen\n${args.summary}`);
      if (args.remaining_notes) parts.push(`## Para la próxima sesión\n${args.remaining_notes}`);
      if (parts.length > 0) {
        newContext = newContext
          ? newContext + '\n\n---\n\n' + parts.join('\n\n')
          : parts.join('\n\n');
      }

      const result = await query(
        `UPDATE work_sessions
         SET status = $1, ${tsField} = NOW(), context = $2, updated_at = NOW()
         WHERE slug = $3
         RETURNING *`,
        [status, newContext, args.slug],
      );

      return { success: true, session: formatSession(result.rows[0]) };
    },
  },

  session_get: {
    description: `[Session Manager] Get a specific session by slug or ID.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: { type: 'string', description: 'Session slug' },
        id: { type: 'number', description: 'Session ID (alternative to slug)' },
      },
    },
    handler: async (args: any) => {
      let result;
      if (args.id) {
        result = await query(`SELECT * FROM work_sessions WHERE id = $1`, [args.id]);
      } else if (args.slug) {
        result = await query(`SELECT * FROM work_sessions WHERE slug = $1`, [args.slug]);
      } else {
        return { found: false, error: 'Provide slug or id' };
      }

      if (result.rows.length === 0) return { found: false };
      return { found: true, session: formatSession(result.rows[0]) };
    },
  },

  session_list: {
    description: `[Session Manager] List work sessions, optionally filtered by tenant or status. Most recent first.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        tenant: { type: 'string', description: 'Filter by tenant' },
        status: {
          type: 'string',
          enum: ['active', 'paused', 'completed'],
          description: 'Filter by status',
        },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
    },
    handler: async (args: any) => {
      let whereClause = 'WHERE 1=1';
      const params: any[] = [];
      let idx = 1;

      if (args.tenant) {
        whereClause += ` AND tenant = $${idx++}`;
        params.push(args.tenant);
      }
      if (args.status) {
        whereClause += ` AND status = $${idx++}`;
        params.push(args.status);
      }

      params.push(args.limit ?? 20);
      const result = await query(
        `SELECT id, slug, tenant, title, focus, status, tags,
                jsonb_array_length(pending_items) as pending_count,
                jsonb_array_length(completed_items) as completed_count,
                started_at, paused_at, completed_at, updated_at
         FROM work_sessions
         ${whereClause}
         ORDER BY updated_at DESC
         LIMIT $${idx}`,
        params,
      );

      return {
        sessions: result.rows,
        count: result.rows.length,
      };
    },
  },
};
