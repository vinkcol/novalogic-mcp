import { query } from '../../../db/client.js';
import { safeRead, listDir, findFiles, existsSync, join } from '../../../shared/fs-helpers.js';
import { PROJECT_ROOT, API_SRC } from '../../../shared/constants.js';

export const tools = {
  backend_get_module: {
    description: `[Backend Dev Agent] Get complete details of an API module — its module definition, controllers, services, repositories, entities, and DTOs. Essential for understanding a domain before making changes.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: {
          type: 'string',
          description:
            'Module name (e.g., "shipping", "pos_legacy", "inventory")',
        },
        include_code: {
          type: 'boolean',
          description: 'Include file contents (default false — only structure)',
        },
      },
      required: ['module_name'],
    },
    handler: async (args: any) => {
      const modPath = join(API_SRC, 'modules', args.module_name);
      if (!existsSync(modPath)) {
        return { error: `Module ${args.module_name} not found`, path: modPath };
      }

      const structure: any = {};
      const dirs = ['controllers', 'services', 'repositories', 'models', 'dto'];

      for (const dir of dirs) {
        const dirPath = join(modPath, dir);
        const files = listDir(dirPath);
        structure[dir] = files.map((f) => {
          const result: any = { name: f };
          if (args.include_code) {
            result.content = safeRead(join(dirPath, f));
          }
          return result;
        });
      }

      // Module file
      const moduleFile = listDir(modPath).find((f) =>
        f.endsWith('.module.ts'),
      );
      if (moduleFile) {
        structure.module_file = {
          name: moduleFile,
          content: args.include_code
            ? safeRead(join(modPath, moduleFile))
            : undefined,
        };
      }

      // Other root files
      const otherFiles = listDir(modPath).filter(
        (f) => !dirs.includes(f) && f !== moduleFile && !f.startsWith('.'),
      );
      structure.other_files = otherFiles;

      return { module: args.module_name, path: modPath, structure };
    },
  },

  backend_get_endpoints: {
    description: `[Backend Dev Agent] Extract all API endpoints from a module's controllers. Returns HTTP methods, paths, decorators, and guard information.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: {
          type: 'string',
          description: 'Module name to scan endpoints for',
        },
      },
      required: ['module_name'],
    },
    handler: async (args: any) => {
      const controllersPath = join(
        API_SRC,
        'modules',
        args.module_name,
        'controllers',
      );
      const files = listDir(controllersPath).filter((f) =>
        f.endsWith('.controller.ts'),
      );

      const endpoints: any[] = [];

      for (const file of files) {
        const content = safeRead(join(controllersPath, file));
        if (!content) continue;

        const controllerMatch = content.match(
          /@Controller\(['"](.+?)['"]\)/,
        );
        const prefix = controllerMatch ? controllerMatch[1] : '';

        const tagMatch = content.match(/@ApiTags\(['"](.+?)['"]\)/);
        const tag = tagMatch
          ? tagMatch[1]
          : file.replace('.controller.ts', '');

        const methodRegex =
          /@(Get|Post|Put|Patch|Delete)\((?:['"](.+?)['"])?\)/g;
        let match;
        while ((match = methodRegex.exec(content)) !== null) {
          const nextLines = content.substring(
            match.index,
            match.index + 500,
          );
          const methodNameMatch = nextLines.match(
            /(?:async\s+)?(\w+)\s*\(/,
          );

          endpoints.push({
            file,
            tag,
            method: match[1].toUpperCase(),
            path: `/api/v1/${prefix}${match[2] ? '/' + match[2] : ''}`,
            handler: methodNameMatch ? methodNameMatch[1] : 'unknown',
          });
        }
      }

      return {
        module: args.module_name,
        endpoints,
        count: endpoints.length,
      };
    },
  },

  backend_get_entity: {
    description: `[Backend Dev Agent] Get a TypeORM entity/model definition with all its columns, relations, and decorators.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        entity_name: {
          type: 'string',
          description:
            'Entity name or file name (e.g., "order", "product", "shipping-order.model")',
        },
        module_name: {
          type: 'string',
          description:
            'Module to search in (optional — searches all if omitted)',
        },
      },
      required: ['entity_name'],
    },
    handler: async (args: any) => {
      const searchBase = args.module_name
        ? join(API_SRC, 'modules', args.module_name)
        : join(API_SRC, 'modules');

      const pattern = new RegExp(
        `${args.entity_name}.*\\.model\\.ts$`,
        'i',
      );
      const files = findFiles(searchBase, pattern);

      if (files.length === 0) {
        const allModels = findFiles(searchBase, /\.model\.ts$/);
        return {
          error: `Entity "${args.entity_name}" not found`,
          available_models: allModels.map((f) =>
            f.replace(searchBase + '\\', '').replace(searchBase + '/', ''),
          ),
        };
      }

      return {
        entities: files.map((f) => ({
          path: f
            .replace(PROJECT_ROOT + '\\', '')
            .replace(PROJECT_ROOT + '/', ''),
          content: safeRead(f),
        })),
      };
    },
  },

  backend_get_service: {
    description: `[Backend Dev Agent] Get a service file's content and analyze its methods and dependencies.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: {
          type: 'string',
          description: 'Module name',
        },
        service_name: {
          type: 'string',
          description:
            'Service file name pattern (optional — returns all services if omitted)',
        },
      },
      required: ['module_name'],
    },
    handler: async (args: any) => {
      const servicesPath = join(
        API_SRC,
        'modules',
        args.module_name,
        'services',
      );
      let files = listDir(servicesPath).filter((f) => f.endsWith('.ts'));

      if (args.service_name) {
        files = files.filter((f) =>
          f.toLowerCase().includes(args.service_name.toLowerCase()),
        );
      }

      return {
        services: files.map((f) => ({
          name: f,
          content: safeRead(join(servicesPath, f)),
        })),
      };
    },
  },

  backend_get_core: {
    description: `[Backend Dev Agent] Get core infrastructure code — guards, interceptors, decorators, database config, etc.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        area: {
          type: 'string',
          enum: [
            'security',
            'guards',
            'interceptors',
            'filters',
            'decorators',
            'database',
            'mail',
            'files',
            'hubs',
            'config',
            'types',
            'utils',
            'all',
          ],
          description: 'Core area to inspect',
        },
        include_code: {
          type: 'boolean',
          description: 'Include file contents',
        },
      },
      required: ['area'],
    },
    handler: async (args: any) => {
      const corePath = join(API_SRC, 'core');

      if (args.area === 'all') {
        const dirs = listDir(corePath);
        return {
          core_areas: dirs,
          structure: dirs.map((d) => ({
            name: d,
            files: listDir(join(corePath, d)),
          })),
        };
      }

      const areaPath = join(corePath, args.area);
      const files = listDir(areaPath).filter((f) => f.endsWith('.ts'));

      return {
        area: args.area,
        files: files.map((f) => ({
          name: f,
          content: args.include_code
            ? safeRead(join(areaPath, f))
            : undefined,
        })),
      };
    },
  },

  backend_record_pattern: {
    description: `[Backend Dev Agent] Record a backend coding pattern for future reference.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Pattern name' },
        description: { type: 'string', description: 'Pattern description' },
        pattern_type: {
          type: 'string',
          description:
            'Type: module, service, controller, repository, entity, dto, guard, interceptor',
        },
        code_example: { type: 'string', description: 'Example code' },
        domain: { type: 'string', description: 'Related domain' },
      },
      required: ['name', 'description'],
    },
    handler: async (args: any) => {
      const result = await query(
        `INSERT INTO code_patterns (agent, name, description, pattern_type, code_example, domain)
         VALUES ('backend', $1, $2, $3, $4, $5) RETURNING id`,
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

  backend_search_code: {
    description: `[Backend Dev Agent] Search for code patterns, function names, class names, or text across the API codebase.`,
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
            'File name pattern to filter (e.g., "*.service.ts", "*.controller.ts")',
        },
        module_name: {
          type: 'string',
          description: 'Limit search to a specific module',
        },
      },
      required: ['search_text'],
    },
    handler: async (args: any) => {
      const searchBase = args.module_name
        ? join(API_SRC, 'modules', args.module_name)
        : API_SRC;

      const filePattern = args.file_pattern
        ? new RegExp(args.file_pattern.replace(/\*/g, '.*'))
        : /\.ts$/;

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
            matches.push({
              line: idx + 1,
              content: line.trim(),
            });
          }
        });

        if (matches.length > 0) {
          results.push({
            file: file
              .replace(PROJECT_ROOT + '\\', '')
              .replace(PROJECT_ROOT + '/', ''),
            matches,
          });
        }
      }

      return {
        query: args.search_text,
        results,
        total_files: results.length,
      };
    },
  },
};
