import { query } from '../../../../db/client.js';

function safeNumber(value: any): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export const tools = {
  growth_get_channel_metrics: {
    description: `[Growth Agent] Get acquisition metrics by channel, including spend, leads, customers and revenue for a given period.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        channel: { type: 'string', description: 'Filter by channel name' },
        period_start: { type: 'string', description: 'Filter from date YYYY-MM-DD' },
        period_end: { type: 'string', description: 'Filter to date YYYY-MM-DD' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let sql = 'SELECT * FROM growth_channel_metrics WHERE project = $1';
      const params: any[] = [project];
      let idx = 2;

      if (args.channel) {
        sql += ` AND channel = $${idx++}`;
        params.push(args.channel);
      }
      if (args.period_start) {
        sql += ` AND period_start >= $${idx++}`;
        params.push(args.period_start);
      }
      if (args.period_end) {
        sql += ` AND period_end <= $${idx++}`;
        params.push(args.period_end);
      }

      sql += ' ORDER BY period_start DESC, channel';
      const result = await query(sql, params);

      return {
        metrics: result.rows,
        count: result.rows.length,
        totals: result.rows.reduce((acc: any, row: any) => ({
          spend: acc.spend + safeNumber(row.spend),
          impressions: acc.impressions + safeNumber(row.impressions),
          clicks: acc.clicks + safeNumber(row.clicks),
          leads: acc.leads + safeNumber(row.leads),
          opportunities: acc.opportunities + safeNumber(row.opportunities),
          customers: acc.customers + safeNumber(row.customers),
          revenue: acc.revenue + safeNumber(row.revenue),
        }), {
          spend: 0,
          impressions: 0,
          clicks: 0,
          leads: 0,
          opportunities: 0,
          customers: 0,
          revenue: 0,
        }),
      };
    },
  },

  growth_save_channel_metrics: {
    description: `[Growth Agent] Save or update channel performance metrics for a fixed period.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        channel: { type: 'string', description: 'Channel name' },
        period_start: { type: 'string', description: 'YYYY-MM-DD' },
        period_end: { type: 'string', description: 'YYYY-MM-DD' },
        spend: { type: 'number', description: 'Ad spend' },
        impressions: { type: 'number', description: 'Impressions count' },
        clicks: { type: 'number', description: 'Clicks count' },
        leads: { type: 'number', description: 'Leads count' },
        opportunities: { type: 'number', description: 'Opportunities count' },
        customers: { type: 'number', description: 'Customers count' },
        revenue: { type: 'number', description: 'Attributed revenue' },
        metadata: { type: 'object', description: 'Extra attribution info' },
      },
      required: ['channel', 'period_start', 'period_end'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO growth_channel_metrics (
           project, channel, period_start, period_end, spend, impressions, clicks, leads,
           opportunities, customers, revenue, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (project, channel, period_start, period_end)
         DO UPDATE SET
           spend = $5,
           impressions = $6,
           clicks = $7,
           leads = $8,
           opportunities = $9,
           customers = $10,
           revenue = $11,
           metadata = $12,
           updated_at = NOW()
         RETURNING id`,
        [
          project,
          args.channel,
          args.period_start,
          args.period_end,
          args.spend || 0,
          args.impressions || 0,
          args.clicks || 0,
          args.leads || 0,
          args.opportunities || 0,
          args.customers || 0,
          args.revenue || 0,
          args.metadata || {},
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Channel metrics for '${args.channel}' saved` };
    },
  },

  growth_get_conversion_funnel: {
    description: `[Growth Agent] Get conversion funnel snapshots and stage drop-offs for a period.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        funnel_name: { type: 'string', description: 'Funnel identifier (default: default)' },
        period_start: { type: 'string', description: 'Filter from date YYYY-MM-DD' },
        period_end: { type: 'string', description: 'Filter to date YYYY-MM-DD' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const funnelName = args.funnel_name || 'default';
      let sql = 'SELECT * FROM growth_funnel_snapshots WHERE project = $1 AND funnel_name = $2';
      const params: any[] = [project, funnelName];
      let idx = 3;

      if (args.period_start) {
        sql += ` AND period_start >= $${idx++}`;
        params.push(args.period_start);
      }
      if (args.period_end) {
        sql += ` AND period_end <= $${idx++}`;
        params.push(args.period_end);
      }

      sql += ' ORDER BY period_start DESC';
      const result = await query(sql, params);
      const latest = result.rows[0] || null;

      return {
        snapshots: result.rows,
        count: result.rows.length,
        latest_dropoff: latest?.stages || [],
      };
    },
  },

  growth_save_conversion_funnel: {
    description: `[Growth Agent] Save or update a conversion funnel snapshot with stage counts and aggregate totals.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        funnel_name: { type: 'string', description: 'Funnel identifier (default: default)' },
        period_start: { type: 'string', description: 'YYYY-MM-DD' },
        period_end: { type: 'string', description: 'YYYY-MM-DD' },
        stages: { type: 'array', items: { type: 'object' }, description: 'Ordered stages with counts and rates' },
        totals: { type: 'object', description: 'Top-level funnel totals' },
        metadata: { type: 'object', description: 'Attribution or segmentation metadata' },
      },
      required: ['period_start', 'period_end', 'stages'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const funnelName = args.funnel_name || 'default';
      const result = await query(
        `INSERT INTO growth_funnel_snapshots (project, funnel_name, period_start, period_end, stages, totals, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (project, funnel_name, period_start, period_end)
         DO UPDATE SET
           stages = $5,
           totals = $6,
           metadata = $7,
           updated_at = NOW()
         RETURNING id`,
        [
          project,
          funnelName,
          args.period_start,
          args.period_end,
          JSON.stringify(args.stages || []),
          args.totals || {},
          args.metadata || {},
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Funnel snapshot '${funnelName}' saved` };
    },
  },

  growth_get_landing_performance: {
    description: `[Growth Agent] Get landing page performance combining stored metrics with content and SEO coverage.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        page_slug: { type: 'string', description: 'Optional page slug filter' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const params: any[] = [project];
      let pageFilterSql = '';

      if (args.page_slug) {
        pageFilterSql = ' AND cp.page_slug = $2';
        params.push(args.page_slug);
      }

      const result = await query(
        `SELECT
           cp.page_slug,
           cp.page_title,
           cp.status,
           seo.score AS seo_score,
           glm.period_start,
           glm.period_end,
           glm.sessions,
           glm.unique_visitors,
           glm.bounce_rate,
           glm.avg_time_seconds,
           glm.conversions,
           glm.conversion_rate
         FROM content_pages cp
         LEFT JOIN content_seo_config seo
           ON seo.project = cp.project AND seo.page_slug = cp.page_slug AND seo.locale = cp.locale
         LEFT JOIN growth_landing_metrics glm
           ON glm.project = cp.project AND glm.page_slug = cp.page_slug
         WHERE cp.project = $1${pageFilterSql}
         ORDER BY cp.page_slug, glm.period_start DESC NULLS LAST`,
        params,
      );

      return { pages: result.rows, count: result.rows.length };
    },
  },

  growth_save_landing_metric: {
    description: `[Growth Agent] Save or update a landing page metric snapshot for a given period.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        page_slug: { type: 'string', description: 'Landing page slug' },
        period_start: { type: 'string', description: 'YYYY-MM-DD' },
        period_end: { type: 'string', description: 'YYYY-MM-DD' },
        sessions: { type: 'number', description: 'Sessions count' },
        unique_visitors: { type: 'number', description: 'Unique visitors count' },
        bounce_rate: { type: 'number', description: 'Bounce rate percentage' },
        avg_time_seconds: { type: 'number', description: 'Average time on page' },
        conversions: { type: 'number', description: 'Conversions count' },
        conversion_rate: { type: 'number', description: 'Conversion rate percentage' },
        metadata: { type: 'object', description: 'Attribution or note fields' },
      },
      required: ['page_slug', 'period_start', 'period_end'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO growth_landing_metrics (
           project, page_slug, period_start, period_end, sessions, unique_visitors, bounce_rate,
           avg_time_seconds, conversions, conversion_rate, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (project, page_slug, period_start, period_end)
         DO UPDATE SET
           sessions = $5,
           unique_visitors = $6,
           bounce_rate = $7,
           avg_time_seconds = $8,
           conversions = $9,
           conversion_rate = $10,
           metadata = $11,
           updated_at = NOW()
         RETURNING id`,
        [
          project,
          args.page_slug,
          args.period_start,
          args.period_end,
          args.sessions || 0,
          args.unique_visitors || 0,
          args.bounce_rate ?? null,
          args.avg_time_seconds ?? null,
          args.conversions || 0,
          args.conversion_rate ?? null,
          args.metadata || {},
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Landing metrics for '${args.page_slug}' saved` };
    },
  },

  growth_get_experiments: {
    description: `[Growth Agent] Get growth experiments across channels, landing pages and lifecycle flows.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        status: { type: 'string', description: 'Filter by experiment status' },
        experiment_type: { type: 'string', description: 'landing, channel, lifecycle, funnel' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let sql = 'SELECT * FROM growth_experiments WHERE project = $1';
      const params: any[] = [project];
      let idx = 2;

      if (args.status) {
        sql += ` AND status = $${idx++}`;
        params.push(args.status);
      }
      if (args.experiment_type) {
        sql += ` AND experiment_type = $${idx++}`;
        params.push(args.experiment_type);
      }

      sql += ' ORDER BY created_at DESC';
      const result = await query(sql, params);
      return { experiments: result.rows, count: result.rows.length };
    },
  },

  growth_save_experiment: {
    description: `[Growth Agent] Save or update a growth experiment with variants, metrics and learnings.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        experiment_name: { type: 'string', description: 'Unique experiment name' },
        experiment_type: { type: 'string', description: 'landing, channel, lifecycle, funnel' },
        target_page: { type: 'string', description: 'Optional page or asset under test' },
        hypothesis: { type: 'string', description: 'Hypothesis being tested' },
        status: { type: 'string', description: 'draft, running, paused, completed, archived' },
        variants: { type: 'array', items: { type: 'object' }, description: 'Variants under test' },
        primary_metric: { type: 'string', description: 'Primary metric' },
        secondary_metrics: { type: 'array', items: { type: 'string' }, description: 'Secondary metrics' },
        results: { type: 'object', description: 'Results and learnings' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
        owner: { type: 'string', description: 'Experiment owner' },
        notes: { type: 'string', description: 'Notes and context' },
        metadata: { type: 'object', description: 'Extra metadata' },
      },
      required: ['experiment_name', 'experiment_type'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO growth_experiments (
           project, experiment_name, experiment_type, target_page, hypothesis, status, variants,
           primary_metric, secondary_metrics, results, start_date, end_date, owner, notes, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (project, experiment_name)
         DO UPDATE SET
           experiment_type = $3,
           target_page = $4,
           hypothesis = $5,
           status = $6,
           variants = $7,
           primary_metric = $8,
           secondary_metrics = $9,
           results = $10,
           start_date = $11,
           end_date = $12,
           owner = $13,
           notes = $14,
           metadata = $15,
           updated_at = NOW()
         RETURNING id`,
        [
          project,
          args.experiment_name,
          args.experiment_type,
          args.target_page || null,
          args.hypothesis || null,
          args.status || 'draft',
          JSON.stringify(args.variants || []),
          args.primary_metric || null,
          JSON.stringify(args.secondary_metrics || []),
          args.results || {},
          args.start_date || null,
          args.end_date || null,
          args.owner || null,
          args.notes || null,
          args.metadata || {},
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Growth experiment '${args.experiment_name}' saved` };
    },
  },
};
