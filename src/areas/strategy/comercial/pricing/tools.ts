import { query } from '../../../../db/client.js';

function normalizeMoney(value: any): number | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export const tools = {
  pricing_get_plans: {
    description: `[Pricing Agent] Get pricing plans, packaging and add-ons ready for comparison across target segments.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        target_persona: { type: 'string', description: 'Filter by primary target persona' },
        include_archived: { type: 'boolean', description: 'Include plans marked as archived in metadata' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let sql = 'SELECT * FROM sales_pricing WHERE project = $1';
      const params: any[] = [project];
      let idx = 2;

      if (args.target_persona) {
        sql += ` AND target_persona ILIKE $${idx++}`;
        params.push(`%${args.target_persona}%`);
      }

      sql += ' ORDER BY sort_order, plan_name';
      const result = await query(sql, params);
      const plans = args.include_archived
        ? result.rows
        : result.rows.filter((plan: any) => !plan.metadata?.archived);

      return { plans, count: plans.length };
    },
  },

  pricing_save_plan: {
    description: `[Pricing Agent] Save or update a pricing plan with packaging details, features, limits and commercial metadata.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        plan_name: { type: 'string', description: 'Display name' },
        plan_slug: { type: 'string', description: 'Stable slug identifier' },
        price_monthly: { type: 'number', description: 'Monthly price' },
        price_yearly: { type: 'number', description: 'Yearly price' },
        currency: { type: 'string', description: 'Currency code (default: COP)' },
        features: { type: 'array', items: { type: 'object' }, description: 'Feature matrix rows' },
        limits: { type: 'object', description: 'Plan limits by key' },
        target_persona: { type: 'string', description: 'Primary target persona' },
        is_popular: { type: 'boolean', description: 'Whether the plan should be highlighted' },
        cta_text: { type: 'string', description: 'Call to action label' },
        sort_order: { type: 'number', description: 'Display ordering' },
        metadata: { type: 'object', description: 'Extra packaging fields like add-ons or badges' },
      },
      required: ['plan_name', 'plan_slug'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO sales_pricing (project, plan_name, plan_slug, price_monthly, price_yearly, currency, features, limits, target_persona, is_popular, cta_text, sort_order, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (project, plan_slug)
         DO UPDATE SET
           plan_name = $2,
           price_monthly = $4,
           price_yearly = $5,
           currency = $6,
           features = $7,
           limits = $8,
           target_persona = $9,
           is_popular = $10,
           cta_text = $11,
           sort_order = $12,
           metadata = $13,
           updated_at = NOW()
         RETURNING id`,
        [
          project,
          args.plan_name,
          args.plan_slug,
          normalizeMoney(args.price_monthly),
          normalizeMoney(args.price_yearly),
          args.currency || 'COP',
          JSON.stringify(args.features || []),
          args.limits || {},
          args.target_persona || null,
          args.is_popular || false,
          args.cta_text || null,
          args.sort_order || 0,
          args.metadata || {},
        ],
      );

      return { success: true, id: result.rows[0].id, message: `Pricing plan '${args.plan_name}' saved` };
    },
  },

  pricing_compare_plans: {
    description: `[Pricing Agent] Compare pricing plans side by side, highlighting missing features, price gaps and positioning tradeoffs.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        plan_slugs: { type: 'array', items: { type: 'string' }, description: 'Explicit plan slugs to compare' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const planSlugs: string[] = Array.isArray(args.plan_slugs) ? args.plan_slugs : [];

      const result = planSlugs.length > 0
        ? await query(
            `SELECT * FROM sales_pricing
             WHERE project = $1 AND plan_slug = ANY($2::text[])
             ORDER BY sort_order, plan_name`,
            [project, planSlugs],
          )
        : await query(
            'SELECT * FROM sales_pricing WHERE project = $1 ORDER BY sort_order, plan_name',
            [project],
          );

      const plans = result.rows;
      const featureMap = new Map<string, Record<string, any>>();

      for (const plan of plans) {
        const features = Array.isArray(plan.features) ? plan.features : [];
        for (const feature of features) {
          const featureName = feature?.name || 'Unnamed feature';
          const row = featureMap.get(featureName) || {};
          row[plan.plan_slug] = feature;
          featureMap.set(featureName, row);
        }
      }

      return {
        plans,
        comparison: Array.from(featureMap.entries()).map(([feature, availability]) => ({
          feature,
          availability,
        })),
        price_spread: plans.map((plan: any) => ({
          plan_slug: plan.plan_slug,
          monthly: normalizeMoney(plan.price_monthly),
          yearly: normalizeMoney(plan.price_yearly),
        })),
      };
    },
  },

  pricing_get_experiments: {
    description: `[Pricing Agent] Get pricing experiments, package tests and monetization hypotheses by status or segment.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        status: { type: 'string', description: 'Filter by experiment status' },
        target_segment: { type: 'string', description: 'Filter by target segment' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let sql = 'SELECT * FROM pricing_experiments WHERE project = $1';
      const params: any[] = [project];
      let idx = 2;

      if (args.status) {
        sql += ` AND status = $${idx++}`;
        params.push(args.status);
      }
      if (args.target_segment) {
        sql += ` AND target_segment ILIKE $${idx++}`;
        params.push(`%${args.target_segment}%`);
      }

      sql += ' ORDER BY created_at DESC';
      const result = await query(sql, params);
      return { experiments: result.rows, count: result.rows.length };
    },
  },

  pricing_save_experiment: {
    description: `[Pricing Agent] Save or update a pricing experiment with variants, baseline and monetization results.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        experiment_name: { type: 'string', description: 'Unique experiment name' },
        target_segment: { type: 'string', description: 'Target segment or persona' },
        hypothesis: { type: 'string', description: 'Hypothesis being tested' },
        pricing_surface: { type: 'string', description: 'Where the price is shown or negotiated' },
        status: { type: 'string', description: 'draft, running, paused, completed, archived' },
        variants: { type: 'array', items: { type: 'object' }, description: 'Price/package variants under test' },
        success_metrics: { type: 'array', items: { type: 'string' }, description: 'Primary success metrics' },
        baseline: { type: 'object', description: 'Baseline metrics before the test' },
        results: { type: 'object', description: 'Observed results or learnings' },
        start_date: { type: 'string', description: 'YYYY-MM-DD' },
        end_date: { type: 'string', description: 'YYYY-MM-DD' },
        owner: { type: 'string', description: 'Experiment owner' },
        notes: { type: 'string', description: 'Notes and interpretation' },
        metadata: { type: 'object', description: 'Extra fields for analysis' },
      },
      required: ['experiment_name'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO pricing_experiments (
           project, experiment_name, target_segment, hypothesis, pricing_surface, status, variants,
           success_metrics, baseline, results, start_date, end_date, owner, notes, metadata
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         ON CONFLICT (project, experiment_name)
         DO UPDATE SET
           target_segment = $3,
           hypothesis = $4,
           pricing_surface = $5,
           status = $6,
           variants = $7,
           success_metrics = $8,
           baseline = $9,
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
          args.target_segment || null,
          args.hypothesis || null,
          args.pricing_surface || null,
          args.status || 'draft',
          JSON.stringify(args.variants || []),
          JSON.stringify(args.success_metrics || []),
          args.baseline || {},
          args.results || {},
          args.start_date || null,
          args.end_date || null,
          args.owner || null,
          args.notes || null,
          args.metadata || {},
        ],
      );

      return { success: true, id: result.rows[0].id, message: `Pricing experiment '${args.experiment_name}' saved` };
    },
  },
};
