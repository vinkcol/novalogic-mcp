import { query } from '../../../../db/client.js';
import { safeRead, listDir, getDirectoryTree } from '../../../../shared/fs-helpers.js';
import { PROJECT_ROOT } from '../../../../shared/constants.js';
import { existsSync } from 'fs';
import { join } from 'path';

export const tools = {
  arch_get_overview: {
    description: `[Architect Agent] Get the complete architectural overview of the Novalogic platform. Returns project structure, module listing, tech stack, and key configuration. Use this as the first tool when you need to understand the project layout.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        depth: {
          type: 'number',
          description: 'Directory tree depth (default 2)',
        },
      },
    },
    handler: async (args: any) => {
      const depth = args.depth || 2;
      const apiTree = getDirectoryTree(
        join(PROJECT_ROOT, 'api', 'src'),
        depth,
      );
      const dashTree = getDirectoryTree(
        join(PROJECT_ROOT, 'dashboard', 'src'),
        depth,
      );

      const domainJson = safeRead(
        join(PROJECT_ROOT, 'novalogic_domain.json'),
      );
      const claudeMd = safeRead(join(PROJECT_ROOT, 'CLAUDE.md'));

      const apiModules = listDir(
        join(PROJECT_ROOT, 'api', 'src', 'modules'),
      );
      const dashFeatures = listDir(
        join(PROJECT_ROOT, 'dashboard', 'src', 'modules'),
      );

      return {
        project: 'Novalogic',
        structure: {
          api: apiTree,
          dashboard: dashTree,
        },
        api_modules: apiModules,
        dashboard_modules: dashFeatures,
        domain_map: domainJson ? JSON.parse(domainJson) : null,
        claude_md_summary: claudeMd ? claudeMd.substring(0, 3000) : null,
      };
    },
  },

  arch_get_module: {
    description: `[Architect Agent] Get detailed information about a specific domain module — its files, structure, entities, services, controllers. Works for both API and Dashboard modules.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: {
          type: 'string',
          description:
            'Module/feature name (e.g., "shipping", "logistics", "pos_legacy", "pos")',
        },
        side: {
          type: 'string',
          enum: ['api', 'dashboard', 'both'],
          description: 'Which side to inspect (default: both)',
        },
      },
      required: ['module_name'],
    },
    handler: async (args: any) => {
      const side = args.side || 'both';
      const result: any = { module: args.module_name };

      if (side === 'api' || side === 'both') {
        const apiPath = join(
          PROJECT_ROOT,
          'api',
          'src',
          'modules',
          args.module_name,
        );
        if (existsSync(apiPath)) {
          result.api = {
            path: apiPath,
            tree: getDirectoryTree(apiPath, 3),
            files: {},
          };
          const moduleFile = listDir(apiPath).find((f) =>
            f.endsWith('.module.ts'),
          );
          if (moduleFile) {
            result.api.files.module = safeRead(join(apiPath, moduleFile));
          }
        } else {
          result.api = { exists: false, path: apiPath };
        }
      }

      if (side === 'dashboard' || side === 'both') {
        const dashPath = join(
          PROJECT_ROOT,
          'dashboard',
          'src',
          'modules',
          args.module_name,
        );
        if (existsSync(dashPath)) {
          result.dashboard = {
            path: dashPath,
            tree: getDirectoryTree(dashPath, 3),
          };
        } else {
          result.dashboard = { exists: false, path: dashPath };
        }
      }

      return result;
    },
  },

  arch_get_dependencies: {
    description: `[Architect Agent] Analyze module dependencies and imports for a given module. Shows what a module depends on and what depends on it.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: {
          type: 'string',
          description: 'Module name to analyze',
        },
        side: {
          type: 'string',
          enum: ['api', 'dashboard'],
          description: 'Which side (api or dashboard)',
        },
      },
      required: ['module_name', 'side'],
    },
    handler: async (args: any) => {
      const basePath =
        args.side === 'api'
          ? join(PROJECT_ROOT, 'api', 'src')
          : join(PROJECT_ROOT, 'dashboard', 'src');

      const modulePath = join(basePath, 'modules', args.module_name);

      if (!existsSync(modulePath)) {
        return {
          error: `Module ${args.module_name} not found at ${modulePath}`,
        };
      }

      const moduleFile =
        args.side === 'api'
          ? listDir(modulePath).find((f) => f.endsWith('.module.ts'))
          : null;

      const moduleContent = moduleFile
        ? safeRead(join(modulePath, moduleFile))
        : null;

      const imports: string[] = [];
      if (moduleContent) {
        const importRegex = /import\s+.*?from\s+['"](.+?)['"]/g;
        let match;
        while ((match = importRegex.exec(moduleContent)) !== null) {
          imports.push(match[1]);
        }
      }

      return {
        module: args.module_name,
        side: args.side,
        module_file: moduleFile,
        imports,
        module_content_preview: moduleContent?.substring(0, 2000),
      };
    },
  },

  arch_record_decision: {
    description: `[Architect Agent] Record an Architecture Decision Record (ADR). Use to document important architectural decisions, their context, and consequences.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Decision title' },
        context: {
          type: 'string',
          description: 'Why this decision was needed',
        },
        decision: { type: 'string', description: 'What was decided' },
        consequences: {
          type: 'string',
          description: 'Expected consequences',
        },
        domain: { type: 'string', description: 'Related domain' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['title', 'decision'],
    },
    handler: async (args: any) => {
      const result = await query(
        `INSERT INTO architecture_decisions (title, context, decision, consequences, domain, tags)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          args.title,
          args.context,
          args.decision,
          args.consequences,
          args.domain,
          args.tags || [],
        ],
      );
      return {
        success: true,
        id: result.rows[0].id,
        message: `ADR recorded: ${args.title}`,
      };
    },
  },

  arch_list_decisions: {
    description: `[Architect Agent] List all Architecture Decision Records, optionally filtered by domain.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Filter by domain' },
        status: {
          type: 'string',
          description: 'Filter by status (proposed, accepted, deprecated)',
        },
      },
    },
    handler: async (args: any) => {
      let sql =
        'SELECT * FROM architecture_decisions WHERE 1=1';
      const params: any[] = [];
      let idx = 1;

      if (args.domain) {
        sql += ` AND domain = $${idx++}`;
        params.push(args.domain);
      }
      if (args.status) {
        sql += ` AND status = $${idx++}`;
        params.push(args.status);
      }
      sql += ' ORDER BY created_at DESC';

      const result = await query(sql, params);
      return { decisions: result.rows, count: result.rows.length };
    },
  },

  arch_get_patterns: {
    description: `[Architect Agent] Get established architectural patterns and conventions for the Novalogic project. Returns the key patterns from CLAUDE.md and stored patterns.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: {
          type: 'string',
          description: 'Specific domain to get patterns for',
        },
      },
    },
    handler: async (args: any) => {
      const claudeMd = safeRead(join(PROJECT_ROOT, 'CLAUDE.md'));

      let sql =
        "SELECT * FROM code_patterns WHERE agent IN ('architect', 'backend', 'frontend')";
      const params: any[] = [];
      if (args.domain) {
        sql += ' AND domain = $1';
        params.push(args.domain);
      }
      sql += ' ORDER BY created_at DESC';

      const dbPatterns = await query(sql, params);

      return {
        claude_md: claudeMd,
        stored_patterns: dbPatterns.rows,
      };
    },
  },

  arch_suggest_placement: {
    description: `[Architect Agent] Suggest where new code should be placed in the Novalogic project based on its purpose and domain. Follows the established module pattern.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        description: {
          type: 'string',
          description: 'What the new code does',
        },
        type: {
          type: 'string',
          enum: [
            'controller',
            'service',
            'repository',
            'entity',
            'dto',
            'component',
            'page',
            'hook',
            'store',
            'saga',
            'util',
          ],
          description: 'Type of code being added',
        },
        domain: {
          type: 'string',
          description: 'Domain it belongs to',
        },
      },
      required: ['description', 'type'],
    },
    handler: async (args: any) => {
      const d = args.domain || '<domain>';
      const placements: Record<string, any> = {
        controller: {
          api_path: `api/src/modules/${d}/controllers/`,
          naming: '<name>.controller.ts',
          conventions: [
            'Decorate with @ApiTags, @ApiBearerAuth, @UseGuards(JwtAuthGuard)',
            'Prefix: /api/v1',
          ],
        },
        service: {
          api_path: `api/src/modules/${d}/services/`,
          naming: '<name>.service.ts',
          conventions: [
            'Injectable',
            'Business logic only',
            'Use repository pattern for DB access',
          ],
        },
        repository: {
          api_path: `api/src/modules/${d}/repositories/`,
          naming: '<name>.repository.ts + <name>.repository.impl.ts',
          conventions: [
            'Abstract interface + TypeORM implementation',
            'Extend TenantRepository for multi-tenant',
          ],
        },
        entity: {
          api_path: `api/src/modules/${d}/models/`,
          naming: '<name>.model.ts',
          conventions: [
            'TypeORM entity',
            'Auto-loaded by *.model.ts glob',
            'Include companyId for tenant isolation',
          ],
        },
        dto: {
          api_path: `api/src/modules/${d}/dto/`,
          naming: '<name>.dto.ts',
          conventions: [
            'Use class-validator decorators',
            'Separate Create/Update DTOs',
          ],
        },
        component: {
          dashboard_path: `dashboard/src/modules/${d}/components/`,
          naming: '<ComponentName>.tsx',
          conventions: [
            'Atomic Design: atoms/molecules/organisms',
            'Feature-specific',
          ],
        },
        page: {
          dashboard_path: `dashboard/src/modules/${d}/pages/`,
          naming: '<PageName>Page.tsx',
          conventions: [
            'Thin wrapper',
            'HelmetConfig for SEO',
            'Renders a Template',
          ],
        },
        hook: {
          dashboard_path: `dashboard/src/modules/${d}/hooks/`,
          naming: 'use<Name>.ts',
          conventions: ['Custom React hook', 'Feature-specific logic'],
        },
        store: {
          dashboard_path: 'dashboard/src/core/store/',
          naming: '<domain>Slice.ts',
          conventions: [
            'Redux Toolkit createSlice',
            'No thunks — use sagas',
          ],
        },
        saga: {
          dashboard_path: 'dashboard/src/core/store/sagas/',
          naming: '<domain>Saga.ts',
          conventions: ['Redux-Saga', 'Handle async side effects'],
        },
        util: {
          api_path: 'api/src/core/utils/',
          dashboard_path: 'dashboard/src/core/utils/',
          naming: '<name>.util.ts or <name>.ts',
          conventions: ['Pure functions', 'Shared utilities'],
        },
      };

      return {
        suggestion: placements[args.type] || { error: 'Unknown type' },
        description: args.description,
        domain: args.domain,
      };
    },
  },
};
