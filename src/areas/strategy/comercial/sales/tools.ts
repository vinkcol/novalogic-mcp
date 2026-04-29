import { query } from '../../../../db/client.js';
import { api } from '../../../../services/api-client.js';

export const tools = {
  sales_get_personas: {
    description: `[Sales B2B Agent] Get buyer personas — ideal customer profiles with pain points, goals, objections, buying triggers, and decision criteria. Essential for targeting copy and features on landing pages.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        name: { type: 'string', description: 'Filter by persona name' },
        company_size: { type: 'string', description: 'Filter: startup, pyme, enterprise' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let sql = 'SELECT * FROM sales_personas WHERE project = $1';
      const params: any[] = [project];
      let idx = 2;

      if (args.name) {
        sql += ` AND name ILIKE $${idx++}`;
        params.push(`%${args.name}%`);
      }
      if (args.company_size) {
        sql += ` AND company_size = $${idx++}`;
        params.push(args.company_size);
      }
      sql += ' ORDER BY name';

      const result = await query(sql, params);
      return { personas: result.rows, count: result.rows.length };
    },
  },

  sales_save_persona: {
    description: `[Sales B2B Agent] Save or update a buyer persona. Defines an ideal customer profile with demographics, pain points, goals, objections, and buying triggers. Upserts by project+name.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        name: { type: 'string', description: 'Persona name (e.g., "Dueño de PYME Retail", "Gerente Logística")' },
        role: { type: 'string', description: 'Job title/role' },
        company_size: { type: 'string', description: 'startup, pyme, enterprise' },
        industry: { type: 'string', description: 'Target industry' },
        pain_points: { type: 'array', items: { type: 'string' }, description: 'Main pain points' },
        goals: { type: 'array', items: { type: 'string' }, description: 'Business goals' },
        objections: { type: 'array', items: { type: 'object' }, description: 'Objections: [{objection, response}]' },
        buying_triggers: { type: 'array', items: { type: 'string' }, description: 'Events that trigger purchase consideration' },
        decision_criteria: { type: 'array', items: { type: 'string' }, description: 'How they evaluate solutions' },
        demographics: { type: 'object', description: 'Age range, location, tech savviness, etc.' },
      },
      required: ['name', 'role'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO sales_personas (project, name, role, company_size, industry, pain_points, goals, objections, buying_triggers, decision_criteria, demographics)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (project, name)
         DO UPDATE SET role = $3, company_size = $4, industry = $5, pain_points = $6, goals = $7, objections = $8, buying_triggers = $9, decision_criteria = $10, demographics = $11, updated_at = NOW()
         RETURNING id`,
        [
          project, args.name, args.role,
          args.company_size || null, args.industry || null,
          JSON.stringify(args.pain_points || []), JSON.stringify(args.goals || []),
          JSON.stringify(args.objections || []), JSON.stringify(args.buying_triggers || []),
          JSON.stringify(args.decision_criteria || []), args.demographics || {},
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Persona '${args.name}' saved` };
    },
  },

  sales_get_content: {
    description: `[Sales B2B Agent] Get sales content — value propositions, objection handlers, competitor analysis, CTAs, testimonials, case studies, FAQs. Filter by content type and funnel stage.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        content_type: {
          type: 'string',
          description: 'Filter: value_prop, objection, competitor, pricing, cta, testimonial, case_study, faq',
        },
        funnel_stage: {
          type: 'string',
          description: 'Filter: awareness, consideration, decision, retention',
        },
        target_persona: { type: 'string', description: 'Filter by target persona name' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      let sql = 'SELECT * FROM sales_content WHERE project = $1';
      const params: any[] = [project];
      let idx = 2;

      if (args.content_type) {
        sql += ` AND content_type = $${idx++}`;
        params.push(args.content_type);
      }
      if (args.funnel_stage) {
        sql += ` AND funnel_stage = $${idx++}`;
        params.push(args.funnel_stage);
      }
      if (args.target_persona) {
        sql += ` AND target_persona ILIKE $${idx++}`;
        params.push(`%${args.target_persona}%`);
      }
      sql += ' ORDER BY priority DESC, created_at DESC';

      const result = await query(sql, params);
      return { content: result.rows, count: result.rows.length };
    },
  },

  sales_save_content: {
    description: `[Sales B2B Agent] Save sales content — value propositions, objection handlers, competitor intel, CTAs, testimonials, case studies, FAQs. Each piece is tagged with funnel stage and target persona for precise placement.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        content_type: {
          type: 'string',
          description: 'Type: value_prop, objection, competitor, pricing, cta, testimonial, case_study, faq',
        },
        title: { type: 'string', description: 'Short title for this content piece' },
        content: { type: 'string', description: 'Full content text' },
        target_persona: { type: 'string', description: 'Which persona this targets' },
        funnel_stage: { type: 'string', description: 'Funnel stage: awareness, consideration, decision, retention' },
        tags: { type: 'array', items: { type: 'string' } },
        priority: { type: 'number', description: 'Priority (higher = more important, default 0)' },
        metadata: { type: 'object', description: 'Extra data (e.g., competitor URL, testimonial author)' },
      },
      required: ['content_type', 'title', 'content'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO sales_content (project, content_type, title, content, target_persona, funnel_stage, tags, priority, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          project, args.content_type, args.title, args.content,
          args.target_persona || null, args.funnel_stage || null,
          args.tags || [], args.priority || 0, args.metadata || {},
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Sales content '${args.title}' saved` };
    },
  },

  sales_update_content: {
    description: `[Sales B2B Agent] Update an existing sales content entry by ID. Use to refine copy, change funnel stage, or update priority.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Content ID to update' },
        title: { type: 'string' },
        content: { type: 'string' },
        target_persona: { type: 'string' },
        funnel_stage: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        priority: { type: 'number' },
        metadata: { type: 'object' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const { id, ...updates } = args;
      const setClauses: string[] = [];
      const params: any[] = [];
      let idx = 1;

      for (const [key, value] of Object.entries(updates)) {
        if (value !== undefined) {
          setClauses.push(`${key} = $${idx++}`);
          params.push(key === 'tags' ? value : (typeof value === 'object' ? JSON.stringify(value) : value));
        }
      }

      if (setClauses.length === 0) return { error: 'No fields to update' };

      setClauses.push('updated_at = NOW()');
      params.push(id);

      await query(
        `UPDATE sales_content SET ${setClauses.join(', ')} WHERE id = $${idx}`,
        params,
      );
      return { success: true, message: `Content ${id} updated` };
    },
  },

  sales_get_pricing: {
    description: `[Sales B2B Agent] Get pricing plans — tiers, features, limits, CTAs. Returns all plans sorted by display order. Essential for pricing section on landing page.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        'SELECT * FROM sales_pricing WHERE project = $1 ORDER BY sort_order, plan_name',
        [project],
      );
      return { plans: result.rows, count: result.rows.length };
    },
  },

  sales_save_pricing: {
    description: `[Sales B2B Agent] Save or update a pricing plan. Defines a tier with monthly/yearly price, features list, limits, target persona, and CTA. Upserts by project+plan_slug.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
        plan_name: { type: 'string', description: 'Display name (e.g., "Emprendedor", "Profesional", "Empresa")' },
        plan_slug: { type: 'string', description: 'URL-safe slug (e.g., "starter", "professional", "enterprise")' },
        price_monthly: { type: 'number', description: 'Monthly price' },
        price_yearly: { type: 'number', description: 'Yearly price (discounted)' },
        currency: { type: 'string', description: 'Currency code (default: COP)' },
        features: {
          type: 'array',
          items: { type: 'object' },
          description: 'Feature list: [{name, included: true/false, limit?: "100/mes"}]',
        },
        limits: { type: 'object', description: 'Plan limits (users, products, locations, etc.)' },
        target_persona: { type: 'string', description: 'Primary target persona' },
        is_popular: { type: 'boolean', description: 'Highlight as recommended plan' },
        cta_text: { type: 'string', description: 'CTA button text' },
        sort_order: { type: 'number', description: 'Display order (0 = first)' },
      },
      required: ['plan_name', 'plan_slug'],
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';
      const result = await query(
        `INSERT INTO sales_pricing (project, plan_name, plan_slug, price_monthly, price_yearly, currency, features, limits, target_persona, is_popular, cta_text, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (project, plan_slug)
         DO UPDATE SET plan_name = $2, price_monthly = $4, price_yearly = $5, currency = $6, features = $7, limits = $8, target_persona = $9, is_popular = $10, cta_text = $11, sort_order = $12, updated_at = NOW()
         RETURNING id`,
        [
          project, args.plan_name, args.plan_slug,
          args.price_monthly || null, args.price_yearly || null,
          args.currency || 'COP', JSON.stringify(args.features || []),
          args.limits || {}, args.target_persona || null,
          args.is_popular || false, args.cta_text || null, args.sort_order || 0,
        ],
      );
      return { success: true, id: result.rows[0].id, message: `Plan '${args.plan_name}' saved` };
    },
  },

  sales_get_funnel_summary: {
    description: `[Sales B2B Agent] Get a summary of all sales content organized by funnel stage. Shows content counts and key pieces per stage (awareness → consideration → decision → retention). Useful for identifying gaps in the sales narrative.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        project: { type: 'string', description: 'Project name (default: novalogic)' },
      },
    },
    handler: async (args: any) => {
      const project = args.project || 'novalogic';

      const stages = ['awareness', 'consideration', 'decision', 'retention'];
      const summary: Record<string, any> = {};

      for (const stage of stages) {
        const result = await query(
          `SELECT content_type, COUNT(*) as count, array_agg(title) as titles
           FROM sales_content WHERE project = $1 AND funnel_stage = $2
           GROUP BY content_type ORDER BY count DESC`,
          [project, stage],
        );
        summary[stage] = {
          total: result.rows.reduce((s: number, r: any) => s + parseInt(r.count), 0),
          by_type: result.rows.map((r: any) => ({
            type: r.content_type,
            count: parseInt(r.count),
            titles: r.titles,
          })),
        };
      }

      // Untagged content
      const untagged = await query(
        'SELECT COUNT(*) as count FROM sales_content WHERE project = $1 AND funnel_stage IS NULL',
        [project],
      );

      const personas = await query(
        'SELECT name, company_size FROM sales_personas WHERE project = $1',
        [project],
      );

      const pricing = await query(
        'SELECT plan_name, plan_slug, is_popular FROM sales_pricing WHERE project = $1 ORDER BY sort_order',
        [project],
      );

      return {
        funnel: summary,
        untagged_content: parseInt(untagged.rows[0].count),
        personas: personas.rows,
        pricing_plans: pricing.rows,
      };
    },
  },

  sales_delete_content: {
    description: `[Sales B2B Agent] Delete a sales content entry by ID.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Content ID to delete' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      await query('DELETE FROM sales_content WHERE id = $1', [args.id]);
      return { success: true, message: `Content ${args.id} deleted` };
    },
  },

  // ==========================================================================
  // SALES FINANCE TOOLS (Internal API)
  // ==========================================================================

  sales_revenue_summary: {
    description: `[Sales B2B Agent] Obtener resumen contable — ingresos, gastos y balance neto por periodo vía Internal API. Útil para reportes financieros y análisis de rentabilidad.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        dateFrom: { type: 'string', description: 'Fecha inicio (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'Fecha fin (YYYY-MM-DD)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.dateFrom) params.set('dateFrom', args.dateFrom);
      if (args.dateTo) params.set('dateTo', args.dateTo);
      const qs = params.toString();
      const res = await api.get(`/accounting/summary${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { summary: res.data };
    },
  },

  sales_profit_summary: {
    description: `[Sales B2B Agent] Obtener resumen de utilidad por origen — ingresos vs gastos desglosados por venta, envío, devolución, etc. vía Internal API.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        dateFrom: { type: 'string', description: 'Fecha inicio (YYYY-MM-DD)' },
        dateTo: { type: 'string', description: 'Fecha fin (YYYY-MM-DD)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.dateFrom) params.set('dateFrom', args.dateFrom);
      if (args.dateTo) params.set('dateTo', args.dateTo);
      const qs = params.toString();
      const res = await api.get(`/accounting/profit-summary${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { profit: res.data };
    },
  },

  sales_finance_dashboard: {
    description: `[Sales B2B Agent] Obtener dashboard financiero — revenue, profit y margin del mes actual vs anterior vía Internal API.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/finance/dashboard');
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { dashboard: res.data };
    },
  },
  sales_directory_import: {
    description: `[Sales B2B Agent] Importa oportunidades descubiertas al Directorio del CRM via Internal API. Disenado para que MCP o scraping registren hallazgos multifuente como fuente de verdad antes de promoverlos al funnel.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          description: 'Batch de registros descubiertos',
          items: {
            type: 'object',
            properties: {
              businessName: { type: 'string' },
              contactFirstName: { type: 'string' },
              contactLastName: { type: 'string' },
              email: { type: 'string' },
              phone: { type: 'string' },
              website: { type: 'string' },
              country: { type: 'string' },
              department: { type: 'string' },
              city: { type: 'string' },
              category: { type: 'string' },
              subcategory: { type: 'string', description: 'Subcategoría opcional del negocio' },
              whatsapp: { type: 'string', description: 'Número de WhatsApp directo' },
              source: { type: 'string', description: 'MCP, SCRAPER, MANUAL, IMPORT' },
              sourceLabel: { type: 'string' },
              sourceUrl: { type: 'string' },
              searchQuery: { type: 'string' },
              tags: { type: 'array', items: { type: 'string' } },
              rawPayload: { type: 'object' },
              metadata: { type: 'object' },
            },
            required: ['businessName'],
          },
        },
      },
      required: ['items'],
    },
    handler: async (args: any) => {
      const res = await api.post('/crm/directorio/import', { items: args.items || [] });
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return res.data;
    },
  },

  sales_directory_list: {
    description: `[Sales B2B Agent] Lista registros del Directorio del CRM con filtros por ubicacion, fuente y estado.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string' },
        status: { type: 'string' },
        source: { type: 'string' },
        country: { type: 'string' },
        department: { type: 'string' },
        city: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      ['search', 'status', 'source', 'country', 'department', 'city'].forEach((key) => {
        if (args[key]) params.set(key, String(args[key]));
      });
      if (args.limit) params.set('limit', String(args.limit));
      if (args.offset) params.set('offset', String(args.offset));
      const qs = params.toString();
      const res = await api.get(`/crm/directorio${qs ? `?${qs}` : ''}`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return { items: res.data.items || [], total: res.data.total || 0 };
    },
  },

  sales_directory_promote: {
    description: `[Sales B2B Agent] Promueve un registro del Directorio del CRM al funnel comercial, creando o reutilizando un lead.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del registro del directorio' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const res = await api.post(`/crm/directorio/${args.id}/promote`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return res.data;
    },
  },

  sales_directory_get: {
    description: `[Sales B2B Agent] Obtiene detalle completo de un registro del Directorio CRM por UUID, incluyendo campos de enriquecimiento, senales comerciales, rating, resenas y notas de revision.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del registro del directorio' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/crm/directorio/${args.id}`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return res.data;
    },
  },

  sales_directory_update: {
    description: `[Sales B2B Agent] Actualiza un registro del Directorio CRM — permite editar contacto, ubicacion, estado, enriquecimiento, revision manual y decisiones. El campo enrichment se hace deep merge (no reemplaza), y reviewNotes.decisions se appenda al historial. Registros PROMOTED no permiten cambiar status, businessName, email, source, sourceUrl ni searchQuery.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del registro' },
        status: { type: 'string', description: 'DISCOVERED, REVIEWED, PROMOTED, REJECTED' },
        businessName: { type: 'string' },
        contactFirstName: { type: 'string' },
        contactLastName: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        whatsapp: { type: 'string', description: 'Número de WhatsApp directo' },
        website: { type: 'string' },
        domain: { type: 'string' },
        address: { type: 'string' },
        city: { type: 'string' },
        department: { type: 'string' },
        country: { type: 'string' },
        category: { type: 'string' },
        subcategory: { type: 'string', description: 'Subcategoría opcional' },
        manualReview: { type: 'boolean', description: 'Marcar como revisado manualmente' },
        reviewDecision: { type: 'string', description: 'candidate, icp_strong, icp_possible, out_of_focus, rejected' },
        reviewNote: { type: 'string', description: 'Nota textual de la revisión comercial' },
        rating: { type: 'number' },
        reviewCount: { type: 'number' },
        tags: { type: 'array', items: { type: 'string' } },
        enrichment: { type: 'object', description: 'Datos parciales de enriquecimiento (se mergea con existente)' },
        reviewNotes: { type: 'object', description: '{ decisions: [{ action, reason, reviewedBy, reviewedAt }] }' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const { id, ...body } = args;
      const res = await api.patch(`/crm/directorio/${id}`, body);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return res.data;
    },
  },

  sales_directory_enrich: {
    description: `[Sales B2B Agent] Enriquece un registro del Directorio CRM por UUID. Ejecuta inferencia de WhatsApp desde teléfono colombiano, extracción de dominio, generación de perfiles sociales probables, cálculo de reputación, refinamiento de categoría y recálculo de quality score e ICP. Idempotente — seguro para re-ejecutar.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del registro a enriquecer' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const res = await api.post(`/crm/directorio/${args.id}/enrich`);
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return res.data;
    },
  },

  sales_directory_enrich_batch: {
    description: `[Sales B2B Agent] Enriquece múltiples registros del Directorio CRM en batch. Acepta array de UUIDs. Retorna resumen de cuántos se enriquecieron y cuáles campos se actualizaron.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array de UUIDs de registros a enriquecer',
        },
      },
      required: ['ids'],
    },
    handler: async (args: any) => {
      const res = await api.post('/crm/directorio/enrich-batch', { ids: args.ids || [] });
      if (!res.ok) return { error: `API error ${res.status}`, data: res.data };
      return res.data;
    },
  },
};
