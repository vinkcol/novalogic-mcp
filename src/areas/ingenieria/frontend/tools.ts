import { statSync } from 'fs';
import { query } from '../../../db/client.js';
import { safeRead, listDir, findFiles, getDirectoryTree, existsSync, join } from '../../../shared/fs-helpers.js';
import { PROJECT_ROOT, DASH_SRC } from '../../../shared/constants.js';

export const tools = {
  frontend_get_feature: {
    description: `[Frontend Dev Agent] Get complete details of a dashboard module — pages, components, hooks, services, store. Essential for understanding a module before making changes.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: {
          type: 'string',
          description:
            'Module name (e.g., "logistics", "pos", "security")',
        },
        depth: {
          type: 'number',
          description: 'Tree depth (default 3)',
        },
      },
      required: ['module_name'],
    },
    handler: async (args: any) => {
      const featPath = join(DASH_SRC, 'modules', args.module_name);
      if (!existsSync(featPath)) {
        const available = listDir(join(DASH_SRC, 'modules'));
        return {
          error: `Module "${args.module_name}" not found`,
          available_modules: available,
        };
      }

      const tree = getDirectoryTree(featPath, args.depth || 3);
      const subdirs = ['pages', 'components', 'hooks', 'services', 'store'];
      const structure: any = {};

      for (const sub of subdirs) {
        const subPath = join(featPath, sub);
        if (existsSync(subPath)) {
          structure[sub] = listDir(subPath);
        }
      }

      return {
        module: args.module_name,
        path: featPath,
        tree,
        structure,
      };
    },
  },

  frontend_get_routes: {
    description: `[Frontend Dev Agent] Get the routing configuration for the dashboard. Returns all defined routes, their components, and access controls.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        filter: {
          type: 'string',
          description: 'Filter routes by path pattern (optional)',
        },
      },
    },
    handler: async (args: any) => {
      const routesFile = safeRead(
        join(DASH_SRC, 'config', 'routes.config.ts'),
      );
      if (!routesFile) {
        return { error: 'routes.config.ts not found' };
      }

      let content = routesFile;
      if (args.filter) {
        const lines = routesFile.split('\n');
        content = lines
          .filter((l) =>
            l.toLowerCase().includes(args.filter.toLowerCase()),
          )
          .join('\n');
      }

      return { routes_config: content };
    },
  },

  frontend_get_rooms: {
    description: `[Frontend Dev Agent] Get the Room system configuration — access control rules, role mappings, and environment flags. Critical for understanding feature access.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        include_environment: {
          type: 'boolean',
          description: 'Also include environment config (default true)',
        },
      },
    },
    handler: async (args: any) => {
      const roomsConfig = safeRead(
        join(DASH_SRC, 'config', 'rooms.config.ts'),
      );
      const envConfig =
        args.include_environment !== false
          ? safeRead(
              join(DASH_SRC, 'config', 'rooms.environment.config.ts'),
            )
          : null;

      return {
        rooms_config: roomsConfig,
        environment_config: envConfig,
      };
    },
  },

  frontend_get_store: {
    description: `[Frontend Dev Agent] Get Redux store structure — slices, sagas, and state shape for a specific domain or the entire store.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        slice_name: {
          type: 'string',
          description:
            'Specific slice name to get details for (optional — lists all if omitted)',
        },
        include_sagas: {
          type: 'boolean',
          description: 'Include saga files (default true)',
        },
      },
    },
    handler: async (args: any) => {
      const storePath = join(DASH_SRC, 'store');
      const slices = listDir(storePath).filter(
        (f) => f.endsWith('Slice.ts') || f.endsWith('slice.ts'),
      );
      const sagas = listDir(join(storePath, 'sagas')).filter((f) =>
        f.endsWith('.ts'),
      );

      if (args.slice_name) {
        const sliceFile = slices.find((f) =>
          f.toLowerCase().includes(args.slice_name.toLowerCase()),
        );
        const sagaFile = sagas.find((f) =>
          f.toLowerCase().includes(args.slice_name.toLowerCase()),
        );

        return {
          slice: sliceFile
            ? {
                name: sliceFile,
                content: safeRead(join(storePath, sliceFile)),
              }
            : null,
          saga:
            args.include_sagas !== false && sagaFile
              ? {
                  name: sagaFile,
                  content: safeRead(join(storePath, 'sagas', sagaFile)),
                }
              : null,
        };
      }

      return {
        slices,
        sagas: args.include_sagas !== false ? sagas : undefined,
        store_index:
          safeRead(join(storePath, 'index.ts')) ||
          safeRead(join(storePath, 'store.ts')),
      };
    },
  },

  frontend_get_component: {
    description: `[Frontend Dev Agent] Get a specific component's code from a module. Supports searching by component name across modules.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        component_name: {
          type: 'string',
          description:
            'Component name or partial name to search for',
        },
        module_name: {
          type: 'string',
          description:
            'Module to search in (optional — searches all if omitted)',
        },
      },
      required: ['component_name'],
    },
    handler: async (args: any) => {
      const searchBase = args.module_name
        ? join(DASH_SRC, 'modules', args.module_name)
        : join(DASH_SRC, 'modules');

      const pattern = new RegExp(
        `${args.component_name}.*\\.(tsx|ts)$`,
        'i',
      );
      const files = findFiles(searchBase, pattern);

      if (files.length === 0) {
        return { error: `Component "${args.component_name}" not found` };
      }

      return {
        components: files.slice(0, 10).map((f) => ({
          path: f
            .replace(PROJECT_ROOT + '\\', '')
            .replace(PROJECT_ROOT + '/', ''),
          content: safeRead(f),
        })),
        total_found: files.length,
      };
    },
  },

  frontend_get_shared: {
    description: `[Frontend Dev Agent] Get shared/common components, hooks, and utilities used across modules.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        area: {
          type: 'string',
          enum: [
            'components',
            'hooks',
            'utils',
            'services',
            'config',
            'styles',
            'types',
            'all',
          ],
          description: 'Shared area to inspect',
        },
      },
      required: ['area'],
    },
    handler: async (args: any) => {
      if (args.area === 'all') {
        const topLevel = listDir(DASH_SRC).filter((d) => {
          try {
            return statSync(join(DASH_SRC, d)).isDirectory();
          } catch {
            return false;
          }
        });
        return { directories: topLevel };
      }

      const areaPath = join(DASH_SRC, args.area);
      if (!existsSync(areaPath)) {
        return { error: `Area "${args.area}" not found at ${areaPath}` };
      }

      return {
        area: args.area,
        tree: getDirectoryTree(areaPath, 2),
      };
    },
  },

  frontend_search_code: {
    description: `[Frontend Dev Agent] Search for code patterns, component names, hooks, or text across the dashboard codebase.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        search_text: {
          type: 'string',
          description: 'Text/pattern to search for',
        },
        file_pattern: {
          type: 'string',
          description:
            'File pattern filter (e.g., "*.tsx", "*.ts")',
        },
        module_name: {
          type: 'string',
          description: 'Limit to specific module',
        },
      },
      required: ['search_text'],
    },
    handler: async (args: any) => {
      const searchBase = args.module_name
        ? join(DASH_SRC, 'modules', args.module_name)
        : DASH_SRC;

      const filePattern = args.file_pattern
        ? new RegExp(args.file_pattern.replace(/\*/g, '.*'))
        : /\.(tsx?|jsx?)$/;

      const files = findFiles(searchBase, filePattern);
      const results: any[] = [];

      for (const file of files) {
        const content = safeRead(file);
        if (!content) continue;

        const lines = content.split('\n');
        const matches: any[] = [];

        lines.forEach((line, idx) => {
          if (
            line.toLowerCase().includes(args.search_text.toLowerCase())
          ) {
            matches.push({ line: idx + 1, content: line.trim() });
          }
        });

        if (matches.length > 0) {
          results.push({
            file: file
              .replace(PROJECT_ROOT + '\\', '')
              .replace(PROJECT_ROOT + '/', ''),
            matches: matches.slice(0, 10),
          });
        }
      }

      return {
        query: args.search_text,
        results: results.slice(0, 30),
        total_files: results.length,
      };
    },
  },

  frontend_record_pattern: {
    description: `[Frontend Dev Agent] Record a frontend coding pattern for future reference.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Pattern name' },
        description: {
          type: 'string',
          description: 'Pattern description',
        },
        pattern_type: {
          type: 'string',
          description:
            'Type: component, page, template, hook, saga, store, style',
        },
        code_example: { type: 'string', description: 'Example code' },
        domain: { type: 'string' },
      },
      required: ['name', 'description'],
    },
    handler: async (args: any) => {
      const result = await query(
        `INSERT INTO code_patterns (agent, name, description, pattern_type, code_example, domain)
         VALUES ('frontend', $1, $2, $3, $4, $5) RETURNING id`,
        [
          args.name,
          args.description,
          args.pattern_type,
          args.code_example,
          args.domain,
        ],
      );
      return { success: true, id: result.rows[0].id };
    },
  },
};
