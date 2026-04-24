import {
  storeMemory,
  searchMemory,
  searchMemoryByText,
  updateMemory,
  deleteMemory,
  listMemories,
  getMemoryStats,
} from '../../../memory/vector-store.js';
import {
  upsertBusinessProcess,
  getBusinessProcess,
  listBusinessProcesses,
} from '../../../knowledge/business-process-store.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { TECH_STACK, NOVALOGIC_DOMAINS, DASHBOARD_FEATURES } from '../../../resources/project-context.js';
import { tools as devopsTools } from '../../ingenieria/devops/tools.js';
import { tools as diagnosticsTools } from '../../ingenieria/diagnostics/tools.js';
import { tools as pmTools } from '../../producto/pm/tools.js';
import { tools as adminOpsTools } from '../../operaciones/admin-ops/tools.js';
import { tools as prospectorTools } from '../../scraping/prospector/tools.js';

function safeReadText(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}\n…(trimmed ${text.length - maxChars} chars)`;
}

export const tools = {
  memory_store: {
    description:
      `[Librarian Agent] Store a piece of knowledge in the project memory. Use this to persist important context about Novalogic - architecture decisions, patterns discovered, debugging insights, domain knowledge, conventions, or any information that should be retained across sessions. Categories: 'architecture', 'pattern', 'convention', 'domain-knowledge', 'debugging', 'decision', 'dependency', 'config', 'workflow'.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description:
            'Memory category: architecture, pattern, convention, domain-knowledge, debugging, decision, dependency, config, workflow',
        },
        title: {
          type: 'string',
          description: 'Short descriptive title for this memory',
        },
        content: {
          type: 'string',
          description: 'The full knowledge content to store',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Tags for filtering (e.g., domain names, tech stack items)',
        },
        metadata: {
          type: 'object',
          description: 'Additional structured metadata',
        },
      },
      required: ['category', 'title', 'content'],
    },
    handler: async (args: any) => {
      const id = await storeMemory({
        agent: 'librarian',
        category: args.category,
        title: args.title,
        content: args.content,
        tags: args.tags || [],
        metadata: args.metadata || {},
      });
      return { success: true, id, message: `Memory stored with ID ${id}` };
    },
  },

  memory_recall: {
    description:
      `[Librarian Agent] Semantically search the project memory. Use this to recall previously stored knowledge about Novalogic. Searches by vector similarity and text matching. Always recall before starting work on a domain to get full context.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Natural language search query',
        },
        category: {
          type: 'string',
          description: 'Filter by category',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Filter by tags',
        },
        limit: {
          type: 'number',
          description: 'Max results (default 10)',
        },
      },
      required: ['query'],
    },
    handler: async (args: any) => {
      const [vectorResults, textResults] = await Promise.all([
        searchMemory(args.query, {
          category: args.category,
          tags: args.tags,
          limit: args.limit || 10,
        }),
        searchMemoryByText(args.query, {
          category: args.category,
          limit: 5,
        }),
      ]);

      const seen = new Set(vectorResults.map((r) => r.id));
      const combined = [...vectorResults];
      for (const r of textResults) {
        if (!seen.has(r.id)) combined.push(r);
      }

      return {
        results: combined.map((r) => ({
          id: r.id,
          category: r.category,
          title: r.title,
          content: r.content,
          tags: r.tags,
          similarity: r.similarity,
          metadata: r.metadata,
        })),
        count: combined.length,
      };
    },
  },

  memory_list: {
    description:
      `[Librarian Agent] List all stored memories, optionally filtered by category. Use to browse what knowledge has been captured about the project.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          description: 'Filter by category',
        },
        limit: { type: 'number', description: 'Max results (default 50)' },
        offset: { type: 'number', description: 'Pagination offset' },
      },
    },
    handler: async (args: any) => {
      const results = await listMemories({
        category: args.category,
        limit: args.limit,
        offset: args.offset,
      });
      return {
        memories: results.map((r) => ({
          id: r.id,
          category: r.category,
          title: r.title,
          tags: r.tags,
          access_count: r.access_count,
          created_at: r.created_at,
        })),
        count: results.length,
      };
    },
  },

  memory_update: {
    description:
      `[Librarian Agent] Update an existing memory entry by ID. Use when knowledge needs to be corrected or expanded.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Memory ID to update' },
        title: { type: 'string' },
        content: { type: 'string' },
        category: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        metadata: { type: 'object' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const { id, ...updates } = args;
      await updateMemory(id, updates);
      return { success: true, message: `Memory ${id} updated` };
    },
  },

  memory_delete: {
    description:
      `[Librarian Agent] Delete a memory entry by ID. Use when information is outdated or incorrect.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Memory ID to delete' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      await deleteMemory(args.id);
      return { success: true, message: `Memory ${args.id} deleted` };
    },
  },

  memory_stats: {
    description:
      `[Librarian Agent] Get statistics about stored memories - counts by agent and category, last update times.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      return await getMemoryStats();
    },
  },

  project_dashboard_quick_context: {
    description:
      `[Librarian Agent] One-shot "quick context + metrics" dashboard for the Novalogic project. Aggregates: vector memory stats + recent memories, CLAUDE.md + domain mapping excerpts, Docker compose status, diagnostics error stats, analytics KPIs, and optional business dashboards. Use as the first call to get oriented fast.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        env: { type: 'string', description: 'development | staging | production (default: NOVALOGIC_ENV)' },

        include_memory: { type: 'boolean', description: 'Include vector memory stats + recent (default true)' },
        memory_recent_limit: { type: 'number', description: 'How many recent memories to include (default 10)' },

        recall_query: { type: 'string', description: 'Optional: run a semantic recall query and include top matches' },
        recall_limit: { type: 'number', description: 'Recall results limit (default 5)' },

        include_project_files: { type: 'boolean', description: 'Include CLAUDE.md and novalogic_domain.json excerpts (default true)' },
        claude_md_max_chars: { type: 'number', description: 'Max chars from CLAUDE.md (default 4000)' },
        domain_json_max_chars: { type: 'number', description: 'Max chars from novalogic_domain.json (default 2500)' },

        include_compose: { type: 'boolean', description: 'Include docker compose status for stacks (default true)' },
        stacks: {
          type: 'array',
          items: { type: 'string' },
          description: 'Stacks to check: api, mcp, dashboard (default: ["mcp","api","dashboard"])',
        },
        include_compose_logs: { type: 'boolean', description: 'Include last 30 compose log lines (default false)' },

        include_diagnostics: { type: 'boolean', description: 'Include API diagnostics error stats (default true)' },
        diag_window_ms: { type: 'number', description: 'Diagnostics window in ms (default 3600000 = 1h)' },

        include_analytics_kpis: { type: 'boolean', description: 'Include analytics KPIs (default true)' },
        kpi_period: { type: 'string', enum: ['weekly', 'monthly', 'yearly', 'custom'], description: 'KPI period (optional)' },
        kpi_year: { type: 'number', description: 'KPI year (optional)' },
        kpi_month: { type: 'number', description: 'KPI month (1-12, optional)' },
        kpi_week: { type: 'number', description: 'KPI week number (optional)' },
        kpi_seller_id: { type: 'string', description: 'KPI sellerId UUID (optional)' },
        kpi_from: { type: 'string', description: 'KPI custom from (YYYY-MM-DD, optional)' },
        kpi_to: { type: 'string', description: 'KPI custom to (YYYY-MM-DD, optional)' },

        include_admin_dashboard_overview: { type: 'boolean', description: 'Include Admin Ops dashboard overview (default false)' },
        start_date: { type: 'string', description: 'Admin dashboard filter start date YYYY-MM-DD (optional)' },
        end_date: { type: 'string', description: 'Admin dashboard filter end date YYYY-MM-DD (optional)' },

        include_scraping_dashboard: { type: 'boolean', description: 'Include scraping dashboard (default false)' },
      },
    },
    handler: async (args: any) => {
      const now = new Date().toISOString();
      const env = (args.env ?? process.env.NOVALOGIC_ENV ?? 'development') as string;
      const projectRoot = process.env.NOVALOGIC_PROJECT_ROOT || '';

      const includeMemory = args.include_memory !== false;
      const includeProjectFiles = args.include_project_files !== false;
      const includeCompose = args.include_compose !== false;
      const includeDiagnostics = args.include_diagnostics !== false;
      const includeAnalyticsKpis = args.include_analytics_kpis !== false;
      const includeAdminOverview = args.include_admin_dashboard_overview === true;
      const includeScrapingDashboard = args.include_scraping_dashboard === true;

      const warnings: string[] = [];

      async function settle<T>(label: string, fn: () => Promise<T>): Promise<T | { error: string }> {
        try {
          return await fn();
        } catch (e: any) {
          const message = e?.message ? String(e.message) : String(e);
          warnings.push(`${label}: ${message}`);
          return { error: message };
        }
      }

      function summarizeComposeStatus(raw: any) {
        if (!raw || raw.error) return raw;

        const result: any = {
          stack: raw.stack,
          path: raw.path,
          composeFiles: raw.composeFiles,
        };

        let services: any[] | null = null;
        if (typeof raw.status === 'string') {
          try {
            const parsed = JSON.parse(raw.status);
            if (Array.isArray(parsed)) services = parsed;
          } catch {
            // leave as null
          }
        }

        if (Array.isArray(services)) {
          const byState: Record<string, number> = {};
          for (const s of services) {
            const state = s?.State || s?.state || 'unknown';
            byState[state] = (byState[state] || 0) + 1;
          }
          result.services = {
            total: services.length,
            byState,
            sample: services.slice(0, 8),
          };
        } else {
          result.status = raw.status;
        }

        if (raw.logs) result.logs = raw.logs;
        return result;
      }

      const context = {
        generated_at: now,
        env,
        project: {
          root: projectRoot || null,
          tech_stack: TECH_STACK,
          domains: NOVALOGIC_DOMAINS,
          dashboard_features: DASHBOARD_FEATURES,
        },
      } as any;

      if (includeProjectFiles) {
        const claudeMax = Number(args.claude_md_max_chars ?? 4000);
        const domainMax = Number(args.domain_json_max_chars ?? 2500);
        const claudePath = projectRoot ? join(projectRoot, 'CLAUDE.md') : '';
        const domainPath = projectRoot ? join(projectRoot, 'novalogic_domain.json') : '';
        const claudeMd = claudePath ? safeReadText(claudePath) : null;
        const domainJson = domainPath ? safeReadText(domainPath) : null;

        context.project.files = {
          claude_md: claudeMd ? trimText(claudeMd, claudeMax) : null,
          novalogic_domain_json: domainJson ? trimText(domainJson, domainMax) : null,
        };
      }

      if (includeMemory) {
        const recentLimit = Number(args.memory_recent_limit ?? 10);
        context.memory = await settle('memory', async () => {
          const [stats, recent] = await Promise.all([
            getMemoryStats(),
            listMemories({ limit: recentLimit, offset: 0 } as any),
          ]);
          return {
            stats,
            recent: recent.map((r: any) => ({
              id: r.id,
              agent: r.agent,
              category: r.category,
              title: r.title,
              tags: r.tags,
              access_count: r.access_count,
              created_at: r.created_at,
            })),
          };
        });
      }

      if (args.recall_query) {
        const recallLimit = Number(args.recall_limit ?? 5);
        const queryText = String(args.recall_query);
        context.memory_recall = await settle('memory_recall', async () => {
          const [vectorResults, textResults] = await Promise.all([
            searchMemory(queryText, { limit: recallLimit } as any),
            searchMemoryByText(queryText, { limit: Math.min(5, recallLimit) } as any),
          ]);

          const seen = new Set(vectorResults.map((r: any) => r.id));
          const combined = [...vectorResults];
          for (const r of textResults) {
            if (!seen.has(r.id)) combined.push(r);
          }

          return {
            query: queryText,
            results: combined.slice(0, recallLimit).map((r: any) => ({
              id: r.id,
              category: r.category,
              title: r.title,
              tags: r.tags,
              similarity: r.similarity,
              content_preview: typeof r.content === 'string' ? trimText(r.content, 600) : null,
            })),
            count: combined.length,
          };
        });
      }

      if (includeCompose) {
        const stacks = Array.isArray(args.stacks) && args.stacks.length > 0
          ? args.stacks
          : ['mcp', 'api', 'dashboard'];
        const includeLogs = args.include_compose_logs === true;

        context.infra = await settle('compose_status', async () => {
          const statuses = await Promise.all(
            stacks.map(async (stack: string) => {
              const raw = await devopsTools.devops_compose_status.handler({
                stack,
                include_logs: includeLogs,
              });
              return summarizeComposeStatus(raw);
            }),
          );
          return { compose: statuses };
        });
      }

      if (includeDiagnostics) {
        const windowMs = Number(args.diag_window_ms ?? 3600000);
        context.diagnostics = await settle('diagnostics', async () => {
          return await diagnosticsTools.diag_stats.handler({ env, window_ms: windowMs });
        });
      }

      if (includeAnalyticsKpis) {
        context.analytics = await settle('analytics_kpis', async () => {
          return await pmTools.pm_get_kpis.handler({
            period: args.kpi_period,
            year: args.kpi_year,
            month: args.kpi_month,
            week: args.kpi_week,
            sellerId: args.kpi_seller_id,
            from: args.kpi_from,
            to: args.kpi_to,
          });
        });
      }

      if (includeAdminOverview) {
        context.dashboard_overview = await settle('admin_dashboard_overview', async () => {
          return await adminOpsTools.admin_ops_dashboard_overview.handler({
            start_date: args.start_date,
            end_date: args.end_date,
          });
        });
      }

      if (includeScrapingDashboard) {
        context.scraping = await settle('scraping_dashboard', async () => {
          return await prospectorTools.scraping_dashboard.handler();
        });
      }

      if (warnings.length) context.warnings = warnings;
      return context;
    },
  },

  business_process_upsert: {
    description:
      `[Librarian Agent] Create or update a Novalogic business process in MongoDB. Use this to define operating flows with structured steps, actors, rules, inputs and outputs, and optionally sync a semantic summary into project memory.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: {
          type: 'string',
          description: 'Stable process identifier (e.g. "erp-sales-order-to-cash")',
        },
        name: {
          type: 'string',
          description: 'Human-readable process name',
        },
        domain: {
          type: 'string',
          description: 'Business domain or vertical (e.g. erp, carrier, commercial, finance)',
        },
        description: {
          type: 'string',
          description: 'What the process does and why it exists',
        },
        goal: {
          type: 'string',
          description: 'Outcome the process should achieve',
        },
        trigger: {
          type: 'string',
          description: 'Event that starts the process',
        },
        status: {
          type: 'string',
          description: 'draft, active, deprecated, archived',
        },
        actors: {
          type: 'array',
          items: { type: 'string' },
          description: 'Roles, teams or systems participating in the process',
        },
        systems: {
          type: 'array',
          items: { type: 'string' },
          description: 'Systems or modules involved',
        },
        inputs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Required inputs',
        },
        outputs: {
          type: 'array',
          items: { type: 'string' },
          description: 'Expected outputs',
        },
        steps: {
          type: 'array',
          items: { type: 'object' },
          description: 'Ordered process steps',
        },
        business_rules: {
          type: 'array',
          items: { type: 'string' },
          description: 'Business rules that constrain the process',
        },
        kpis: {
          type: 'array',
          items: { type: 'string' },
          description: 'KPIs used to evaluate the process',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for filtering and grouping',
        },
        metadata: {
          type: 'object',
          description: 'Additional structured metadata',
        },
        sync_memory: {
          type: 'boolean',
          description: 'Also store a semantic summary in PostgreSQL memory (default true)',
        },
      },
      required: ['slug', 'name', 'domain'],
    },
    handler: async (args: any) => {
      const process = await upsertBusinessProcess({
        slug: args.slug,
        name: args.name,
        domain: args.domain,
        description: args.description,
        goal: args.goal,
        trigger: args.trigger,
        status: args.status,
        actors: args.actors,
        systems: args.systems,
        inputs: args.inputs,
        outputs: args.outputs,
        steps: args.steps,
        business_rules: args.business_rules,
        kpis: args.kpis,
        tags: args.tags,
        metadata: args.metadata,
      });

      let syncedMemoryId: number | null = null;
      if (args.sync_memory !== false) {
        const summaryParts = [
          args.description ? `Descripcion: ${args.description}` : null,
          args.goal ? `Objetivo: ${args.goal}` : null,
          args.trigger ? `Disparador: ${args.trigger}` : null,
          Array.isArray(args.actors) && args.actors.length > 0
            ? `Actores: ${args.actors.join(', ')}`
            : null,
          Array.isArray(args.systems) && args.systems.length > 0
            ? `Sistemas: ${args.systems.join(', ')}`
            : null,
          Array.isArray(args.inputs) && args.inputs.length > 0
            ? `Entradas: ${args.inputs.join(', ')}`
            : null,
          Array.isArray(args.outputs) && args.outputs.length > 0
            ? `Salidas: ${args.outputs.join(', ')}`
            : null,
          Array.isArray(args.business_rules) && args.business_rules.length > 0
            ? `Reglas: ${args.business_rules.join(' | ')}`
            : null,
          Array.isArray(args.kpis) && args.kpis.length > 0
            ? `KPIs: ${args.kpis.join(', ')}`
            : null,
          Array.isArray(args.steps) && args.steps.length > 0
            ? `Pasos: ${args.steps
                .map((step: any, index: number) => {
                  if (typeof step === 'string') return `${index + 1}. ${step}`;
                  const name = step?.name || step?.title || `Paso ${index + 1}`;
                  const owner = step?.owner ? ` [${step.owner}]` : '';
                  return `${index + 1}. ${name}${owner}`;
                })
                .join(' ')}`
            : null,
        ].filter(Boolean);

        syncedMemoryId = await storeMemory({
          agent: 'librarian',
          category: 'workflow',
          title: `Proceso de negocio: ${args.name}`,
          content: summaryParts.join('\n'),
          tags: ['business-process', args.domain, ...(args.tags || [])],
          metadata: {
            source: 'mongodb',
            process_slug: args.slug,
            process_status: process.status,
          },
        });
      }

      return {
        success: true,
        process,
        synced_memory_id: syncedMemoryId,
      };
    },
  },

  business_process_get: {
    description:
      `[Librarian Agent] Get a single Novalogic business process document from MongoDB by slug.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: {
          type: 'string',
          description: 'Stable process identifier',
        },
      },
      required: ['slug'],
    },
    handler: async (args: any) => {
      const process = await getBusinessProcess(args.slug);
      return {
        found: !!process,
        process: process || null,
      };
    },
  },

  business_process_list: {
    description:
      `[Librarian Agent] List business processes stored in MongoDB, optionally filtered by domain, status, or tag.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description: 'Filter by domain',
        },
        status: {
          type: 'string',
          description: 'Filter by status',
        },
        tag: {
          type: 'string',
          description: 'Filter by tag',
        },
        limit: {
          type: 'number',
          description: 'Max results (default 50)',
        },
      },
    },
    handler: async (args: any) => {
      const processes = await listBusinessProcesses({
        domain: args.domain,
        status: args.status,
        tag: args.tag,
        limit: args.limit,
      });

      return {
        processes,
        count: processes.length,
      };
    },
  },
};
