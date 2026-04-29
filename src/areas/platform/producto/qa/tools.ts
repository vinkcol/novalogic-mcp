import { readdirSync, statSync } from 'fs';
import { query } from '../../../../db/client.js';
import { api } from '../../../../services/api-client.js';
import { tools as browserTools } from '../../../app/operaciones/browser/tools.js';
import { safeRead, findFiles, existsSync, join } from '../../../../shared/fs-helpers.js';
import { PROJECT_ROOT } from '../../../../shared/constants.js';

export const tools = {
  qa_report_issue: {
    description: `[QA Agent] Report a quality issue found in the codebase. Tracks bugs, convention violations, security concerns, and technical debt.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Issue title' },
        description: {
          type: 'string',
          description: 'Detailed description',
        },
        severity: {
          type: 'string',
          enum: ['critical', 'major', 'minor', 'trivial'],
        },
        domain: {
          type: 'string',
          description: 'Affected domain',
        },
        file_path: {
          type: 'string',
          description: 'File where issue was found',
        },
        line_number: { type: 'number', description: 'Line number' },
        category: {
          type: 'string',
          description:
            'Issue category: bug, convention-violation, security, performance, accessibility, type-safety, test-coverage',
        },
        reproduction_steps: {
          type: 'array',
          items: { type: 'string' },
          description: 'Steps to reproduce',
        },
      },
      required: ['title', 'severity'],
    },
    handler: async (args: any) => {
      const result = await query(
        `INSERT INTO qa_issues (title, description, severity, domain, file_path, line_number, category, reproduction_steps)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          args.title,
          args.description,
          args.severity,
          args.domain,
          args.file_path,
          args.line_number,
          args.category,
          JSON.stringify(args.reproduction_steps || []),
        ],
      );
      return {
        success: true,
        id: result.rows[0].id,
        message: `Issue reported: ${args.title}`,
      };
    },
  },

  qa_list_issues: {
    description: `[QA Agent] List all reported QA issues with filters.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        severity: {
          type: 'string',
          enum: ['critical', 'major', 'minor', 'trivial'],
        },
        status: {
          type: 'string',
          enum: [
            'open',
            'investigating',
            'confirmed',
            'fixed',
            'wont_fix',
            'closed',
          ],
        },
        domain: { type: 'string' },
        category: { type: 'string' },
        limit: { type: 'number' },
      },
    },
    handler: async (args: any) => {
      let sql = 'SELECT * FROM qa_issues WHERE 1=1';
      const params: any[] = [];
      let idx = 1;

      if (args.severity) {
        sql += ` AND severity = $${idx++}`;
        params.push(args.severity);
      }
      if (args.status) {
        sql += ` AND status = $${idx++}`;
        params.push(args.status);
      }
      if (args.domain) {
        sql += ` AND domain = $${idx++}`;
        params.push(args.domain);
      }
      if (args.category) {
        sql += ` AND category = $${idx++}`;
        params.push(args.category);
      }

      sql += ` ORDER BY
        CASE severity WHEN 'critical' THEN 0 WHEN 'major' THEN 1 WHEN 'minor' THEN 2 WHEN 'trivial' THEN 3 END,
        created_at DESC`;
      sql += ` LIMIT $${idx}`;
      params.push(args.limit || 50);

      const result = await query(sql, params);
      return { issues: result.rows, count: result.rows.length };
    },
  },

  qa_update_issue: {
    description: `[QA Agent] Update a QA issue status or details.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'Issue ID' },
        status: {
          type: 'string',
          enum: [
            'open',
            'investigating',
            'confirmed',
            'fixed',
            'wont_fix',
            'closed',
          ],
        },
        description: { type: 'string' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const sets: string[] = [];
      const params: any[] = [];
      let idx = 1;

      if (args.status) {
        sets.push(`status = $${idx++}`);
        params.push(args.status);
        if (['fixed', 'closed', 'wont_fix'].includes(args.status)) {
          sets.push('resolved_at = NOW()');
        }
      }
      if (args.description) {
        sets.push(`description = $${idx++}`);
        params.push(args.description);
      }

      if (sets.length === 0)
        return { error: 'No updates provided' };

      params.push(args.id);
      await query(
        `UPDATE qa_issues SET ${sets.join(', ')} WHERE id = $${idx}`,
        params,
      );
      return { success: true, message: `Issue ${args.id} updated` };
    },
  },

  qa_check_conventions: {
    description: `[QA Agent] Check a module against Novalogic coding conventions. Validates file naming, structure patterns, required files, and common mistakes.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: {
          type: 'string',
          description: 'Module name to check',
        },
        side: {
          type: 'string',
          enum: ['api', 'dashboard'],
          description: 'Which side to check',
        },
      },
      required: ['module_name', 'side'],
    },
    handler: async (args: any) => {
      const issues: string[] = [];
      const passes: string[] = [];

      if (args.side === 'api') {
        const modPath = join(
          PROJECT_ROOT,
          'api',
          'src',
          'modules',
          args.module_name,
        );
        if (!existsSync(modPath)) {
          return { error: `Module ${args.module_name} not found` };
        }

        // Check required directories
        const requiredDirs = ['controllers', 'services', 'dto', 'models'];
        for (const dir of requiredDirs) {
          if (existsSync(join(modPath, dir))) {
            passes.push(`Has ${dir}/ directory`);
          } else {
            issues.push(`Missing ${dir}/ directory`);
          }
        }

        // Check module file
        const files = readdirSync(modPath);
        const hasModule = files.some((f) => f.endsWith('.module.ts'));
        if (hasModule) passes.push('Has module file');
        else issues.push('Missing .module.ts file');

        // Check controller conventions
        const ctrlPath = join(modPath, 'controllers');
        if (existsSync(ctrlPath)) {
          const controllers = readdirSync(ctrlPath).filter((f) =>
            f.endsWith('.controller.ts'),
          );
          for (const ctrl of controllers) {
            const content = safeRead(join(ctrlPath, ctrl)) || '';
            if (content.includes('@ApiTags'))
              passes.push(`${ctrl}: Has @ApiTags`);
            else issues.push(`${ctrl}: Missing @ApiTags decorator`);
            if (content.includes('@ApiBearerAuth'))
              passes.push(`${ctrl}: Has @ApiBearerAuth`);
            else
              issues.push(
                `${ctrl}: Missing @ApiBearerAuth decorator`,
              );
            if (content.includes('JwtAuthGuard'))
              passes.push(`${ctrl}: Uses JwtAuthGuard`);
            else issues.push(`${ctrl}: Missing JwtAuthGuard`);
          }
        }

        // Check model conventions
        const modelPath = join(modPath, 'models');
        if (existsSync(modelPath)) {
          const models = readdirSync(modelPath).filter((f) =>
            f.endsWith('.model.ts'),
          );
          for (const model of models) {
            const content = safeRead(join(modelPath, model)) || '';
            if (
              content.includes('companyId') ||
              content.includes('company_id')
            ) {
              passes.push(
                `${model}: Has tenant isolation (companyId)`,
              );
            } else {
              issues.push(
                `${model}: May be missing tenant isolation (companyId)`,
              );
            }
          }
        }

        // Check DTO conventions
        const dtoPath = join(modPath, 'dto');
        if (existsSync(dtoPath)) {
          const dtos = readdirSync(dtoPath).filter((f) =>
            f.endsWith('.dto.ts'),
          );
          for (const dto of dtos) {
            const content = safeRead(join(dtoPath, dto)) || '';
            if (
              content.includes('class-validator') ||
              content.includes('IsString') ||
              content.includes('IsNumber') ||
              content.includes('IsNotEmpty')
            ) {
              passes.push(`${dto}: Uses class-validator`);
            } else {
              issues.push(
                `${dto}: May be missing class-validator decorators`,
              );
            }
          }
        }
      }

      if (args.side === 'dashboard') {
        const featPath = join(
          PROJECT_ROOT,
          'dashboard',
          'src',
          'modules',
          args.module_name,
        );
        if (!existsSync(featPath)) {
          return { error: `Module ${args.module_name} not found` };
        }

        const hasPages = existsSync(join(featPath, 'pages'));
        const hasComponents = existsSync(
          join(featPath, 'components'),
        );

        if (hasPages) passes.push('Has pages/ directory');
        else issues.push('Missing pages/ directory');
        if (hasComponents) passes.push('Has components/ directory');
        else issues.push('Missing components/ directory');

        // Check page pattern
        if (hasPages) {
          const pages = readdirSync(join(featPath, 'pages')).filter(
            (f) => f.endsWith('.tsx'),
          );
          for (const page of pages) {
            const content =
              safeRead(join(featPath, 'pages', page)) || '';
            if (content.includes('HelmetConfig'))
              passes.push(`${page}: Uses HelmetConfig`);
            else
              issues.push(
                `${page}: Missing HelmetConfig for SEO`,
              );
          }
        }

        // Check Atomic Design
        if (hasComponents) {
          const compDirs = readdirSync(
            join(featPath, 'components'),
          );
          const atomicDirs = [
            'atoms',
            'molecules',
            'organisms',
            'templates',
          ];
          const hasAtomic = atomicDirs.some((d) =>
            compDirs.includes(d),
          );
          if (hasAtomic)
            passes.push('Follows Atomic Design pattern');
          else
            issues.push(
              'Components not organized in Atomic Design (atoms/molecules/organisms)',
            );
        }
      }

      return {
        module: args.module_name,
        side: args.side,
        issues,
        passes,
        score:
          passes.length > 0
            ? Math.round(
                (passes.length / (passes.length + issues.length)) *
                  100,
              )
            : 0,
      };
    },
  },

  qa_create_checklist: {
    description: `[QA Agent] Create a reusable QA checklist for a domain or module type.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Checklist name' },
        domain: {
          type: 'string',
          description: 'Domain this applies to',
        },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              check: { type: 'string' },
              category: { type: 'string' },
              severity: { type: 'string' },
            },
          },
          description: 'Checklist items',
        },
      },
      required: ['name', 'items'],
    },
    handler: async (args: any) => {
      const result = await query(
        `INSERT INTO qa_checklists (name, domain, items) VALUES ($1, $2, $3) RETURNING id`,
        [args.name, args.domain, JSON.stringify(args.items)],
      );
      return { success: true, id: result.rows[0].id };
    },
  },

  qa_get_checklists: {
    description: `[QA Agent] Get available QA checklists.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string' },
      },
    },
    handler: async (args: any) => {
      let sql = 'SELECT * FROM qa_checklists';
      const params: any[] = [];
      if (args.domain) {
        sql += ' WHERE domain = $1';
        params.push(args.domain);
      }
      sql += ' ORDER BY created_at DESC';
      const result = await query(sql, params);
      return { checklists: result.rows };
    },
  },

  qa_find_test_files: {
    description: `[QA Agent] Find test files for a module. Shows which areas have tests and which are missing.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: {
          type: 'string',
          description: 'Module name',
        },
        side: {
          type: 'string',
          enum: ['api', 'dashboard', 'both'],
        },
      },
      required: ['module_name'],
    },
    handler: async (args: any) => {
      const result: any = { module: args.module_name };
      const side = args.side || 'both';

      if (side === 'api' || side === 'both') {
        const apiBase = join(
          PROJECT_ROOT,
          'api',
          'src',
          'modules',
          args.module_name,
        );
        const testFiles = findFiles(apiBase, /\.(spec|test)\.ts$/);
        const sourceFiles = findFiles(
          apiBase,
          /(?<!\.spec|\.test)\.ts$/,
        ).filter(
          (f) =>
            !f.includes('.spec.') && !f.includes('.test.'),
        );

        result.api = {
          test_files: testFiles.map((f) =>
            f
              .replace(PROJECT_ROOT + '\\', '')
              .replace(PROJECT_ROOT + '/', ''),
          ),
          source_files_count: sourceFiles.length,
          test_files_count: testFiles.length,
          coverage_ratio:
            sourceFiles.length > 0
              ? `${testFiles.length}/${sourceFiles.length}`
              : 'N/A',
        };
      }

      if (side === 'dashboard' || side === 'both') {
        const dashBase = join(
          PROJECT_ROOT,
          'dashboard',
          'src',
          'modules',
          args.module_name,
        );
        const testFiles = findFiles(
          dashBase,
          /\.(spec|test)\.(ts|tsx)$/,
        );
        const sourceFiles = findFiles(
          dashBase,
          /\.(ts|tsx)$/,
        ).filter(
          (f) =>
            !f.includes('.spec.') && !f.includes('.test.'),
        );

        result.dashboard = {
          test_files: testFiles.map((f) =>
            f
              .replace(PROJECT_ROOT + '\\', '')
              .replace(PROJECT_ROOT + '/', ''),
          ),
          source_files_count: sourceFiles.length,
          test_files_count: testFiles.length,
          coverage_ratio:
            sourceFiles.length > 0
              ? `${testFiles.length}/${sourceFiles.length}`
              : 'N/A',
        };
      }

      return result;
    },
  },

  qa_check_imports: {
    description: `[QA Agent] Validate that all TypeScript imports in a module resolve to existing files. Detects broken imports after renames or moves.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: { type: 'string', description: 'Module name' },
        side: { type: 'string', enum: ['api', 'dashboard'], description: 'Which side to check' },
      },
      required: ['module_name', 'side'],
    },
    handler: async (args: any) => {
      const basePath = args.side === 'api'
        ? join(PROJECT_ROOT, 'api', 'src', 'modules', args.module_name)
        : join(PROJECT_ROOT, 'dashboard', 'src', 'modules', args.module_name);

      if (!existsSync(basePath)) {
        return { error: `Path not found: ${args.module_name} (${args.side})` };
      }

      const tsFiles = findFiles(basePath, /\.tsx?$/);
      const broken: { file: string; import_path: string; line: number }[] = [];
      const checked = { files: 0, imports: 0 };

      for (const file of tsFiles) {
        const content = safeRead(file);
        if (!content) continue;
        checked.files++;

        const lines = content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const match = lines[i].match(/from\s+['"](\.[^'"]+)['"]/);
          if (!match) continue;
          checked.imports++;

          const importPath = match[1];
          const dir = join(file, '..');
          const resolved = join(dir, importPath);

          // Check common extensions
          const extensions = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx', '/index.js'];
          const found = extensions.some(ext => existsSync(resolved + ext));

          if (!found) {
            broken.push({
              file: file.replace(PROJECT_ROOT, '').replace(/\\/g, '/'),
              import_path: importPath,
              line: i + 1,
            });
          }
        }
      }

      return {
        module: args.module_name,
        side: args.side,
        checked,
        broken_imports: broken,
        broken_count: broken.length,
        status: broken.length === 0 ? 'ALL_IMPORTS_VALID' : 'BROKEN_IMPORTS_FOUND',
      };
    },
  },

  qa_check_entity_usage: {
    description: `[QA Agent] Cross-reference TypeORM entity fields against service usage. Detects field name mismatches after entity changes (e.g. renamed columns not updated in services).`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        module_name: { type: 'string', description: 'API module name' },
      },
      required: ['module_name'],
    },
    handler: async (args: any) => {
      const modPath = join(PROJECT_ROOT, 'api', 'src', 'modules', args.module_name);
      if (!existsSync(modPath)) {
        return { error: `Module not found: ${args.module_name}` };
      }

      const modelFiles = findFiles(join(modPath, 'models'), /\.model\.ts$/);
      const serviceFiles = findFiles(join(modPath, 'services'), /\.service\.ts$/);
      const repoFiles = findFiles(join(modPath, 'repositories'), /\.ts$/);

      // Extract entity fields from models
      const entities: Record<string, string[]> = {};
      for (const mf of modelFiles) {
        const content = safeRead(mf) || '';
        const className = content.match(/export\s+class\s+(\w+)/)?.[1] || 'Unknown';
        const fields: string[] = [];
        const columnRegex = /@(?:Column|JoinColumn|ManyToOne|OneToMany|ManyToMany|OneToOne)[^]*?\n\s+(\w+)[\s:?]/g;
        let m;
        while ((m = columnRegex.exec(content)) !== null) {
          if (m[1] && !m[1].startsWith('_')) fields.push(m[1]);
        }
        entities[className] = fields;
      }

      // Check service/repo files for field references that don't exist in entities
      const warnings: { file: string; entity: string; field: string; line: number }[] = [];
      const allConsumerFiles = [...serviceFiles, ...repoFiles];

      for (const sf of allConsumerFiles) {
        const content = safeRead(sf) || '';
        const lines = content.split('\n');

        for (const [entityName, fields] of Object.entries(entities)) {
          // Look for patterns like `entity.fieldName` or `{ fieldName: ` in object literals
          for (let i = 0; i < lines.length; i++) {
            const dotAccess = lines[i].match(new RegExp(`\\b\\w+\\.(\\w+)`, 'g'));
            if (dotAccess) {
              for (const access of dotAccess) {
                const field = access.split('.')[1];
                // Only flag if it looks like it could be an entity field access
                // and the entity is referenced in this file
                if (
                  field &&
                  content.includes(entityName) &&
                  lines[i].toLowerCase().includes(entityName.toLowerCase().slice(0, 4)) &&
                  !fields.includes(field) &&
                  !['length', 'map', 'filter', 'find', 'forEach', 'push', 'reduce', 'some', 'every', 'includes', 'join', 'toString', 'valueOf', 'id', 'constructor', 'prototype', 'create', 'save', 'remove', 'update', 'delete', 'findOne', 'findMany', 'query', 'then', 'catch', 'message', 'status', 'data', 'rows', 'count', 'affected'].includes(field)
                ) {
                  warnings.push({
                    file: sf.replace(PROJECT_ROOT, '').replace(/\\/g, '/'),
                    entity: entityName,
                    field,
                    line: i + 1,
                  });
                }
              }
            }
          }
        }
      }

      return {
        module: args.module_name,
        entities: Object.fromEntries(
          Object.entries(entities).map(([k, v]) => [k, { field_count: v.length, fields: v }]),
        ),
        potential_mismatches: warnings.slice(0, 50),
        warning_count: warnings.length,
        status: warnings.length === 0 ? 'NO_MISMATCHES' : 'POTENTIAL_MISMATCHES_FOUND',
      };
    },
  },

  qa_get_metrics: {
    description: `[QA Agent] Get QA metrics — issue counts by severity, resolution rates, most affected domains.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const [bySeverity, byStatus, byDomain, byCategory] =
        await Promise.all([
          query(
            `SELECT severity, COUNT(*) as count FROM qa_issues GROUP BY severity`,
          ),
          query(
            `SELECT status, COUNT(*) as count FROM qa_issues GROUP BY status`,
          ),
          query(
            `SELECT domain, COUNT(*) as count FROM qa_issues WHERE domain IS NOT NULL GROUP BY domain ORDER BY count DESC`,
          ),
          query(
            `SELECT category, COUNT(*) as count FROM qa_issues WHERE category IS NOT NULL GROUP BY category ORDER BY count DESC`,
          ),
        ]);

      return {
        by_severity: bySeverity.rows,
        by_status: byStatus.rows,
        by_domain: byDomain.rows,
        by_category: byCategory.rows,
      };
    },
  },

  // ==========================================================================
  // QA BROWSER TESTING TOOLS
  // ==========================================================================

  qa_save_test_flow: {
    description: `[QA Agent] Save (upsert) a reusable browser test flow. Steps use the same format as browser_run_flow plus optional label and assertion. Template variables {{var}} in steps are resolved from test_data at runtime.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Unique flow name (e.g. "Login Admin")' },
        description: { type: 'string', description: 'What this flow tests' },
        domain: { type: 'string', description: 'Domain area (e.g. "auth", "pos", "shipping")' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags for filtering' },
        steps: {
          type: 'array',
          description: 'Test steps — each has action, selector, value, label, assertion',
          items: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['navigate', 'click', 'fill', 'select', 'check', 'press', 'wait', 'screenshot', 'evaluate'] },
              selector: { type: 'string' },
              value: { type: 'string' },
              label: { type: 'string', description: 'Human-readable step label' },
              wait_after: { type: 'number' },
              assertion: {
                type: 'object',
                description: 'Assertion to validate after step',
                properties: {
                  type: { type: 'string', enum: ['visible', 'hidden', 'text_contains', 'url_contains', 'eval_truthy'] },
                  selector: { type: 'string' },
                  value: { type: 'string' },
                },
              },
            },
            required: ['action'],
          },
        },
        preconditions: { type: 'array', items: { type: 'string' }, description: 'Names of flows that must run first' },
        test_data: { type: 'object', description: 'Template variables: {email, password, etc.}' },
        expected_url: { type: 'string', description: 'Expected URL after flow completes' },
        timeout_ms: { type: 'number', description: 'Global timeout (default: 30000)' },
      },
      required: ['name', 'steps'],
    },
    handler: async (args: any) => {
      // Validate steps
      for (let i = 0; i < args.steps.length; i++) {
        if (!args.steps[i].action) {
          return { error: `Step ${i + 1} is missing 'action' field` };
        }
      }

      const result = await query(
        `INSERT INTO qa_test_flows (name, description, domain, tags, steps, preconditions, test_data, expected_url, timeout_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           domain = EXCLUDED.domain,
           tags = EXCLUDED.tags,
           steps = EXCLUDED.steps,
           preconditions = EXCLUDED.preconditions,
           test_data = EXCLUDED.test_data,
           expected_url = EXCLUDED.expected_url,
           timeout_ms = EXCLUDED.timeout_ms,
           updated_at = NOW()
         RETURNING id, (xmax = 0) AS is_new`,
        [
          args.name,
          args.description || null,
          args.domain || null,
          args.tags || [],
          JSON.stringify(args.steps),
          JSON.stringify(args.preconditions || []),
          JSON.stringify(args.test_data || {}),
          args.expected_url || null,
          args.timeout_ms || 30000,
        ],
      );

      const row = result.rows[0];
      return {
        success: true,
        id: row.id,
        action: row.is_new ? 'created' : 'updated',
        name: args.name,
        steps_count: args.steps.length,
      };
    },
  },

  qa_list_test_flows: {
    description: `[QA Agent] List saved browser test flows with optional filters. Shows last run status from test results.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        domain: { type: 'string', description: 'Filter by domain' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Filter by tags (any match)' },
        enabled_only: { type: 'boolean', description: 'Only enabled flows (default: true)' },
      },
    },
    handler: async (args: any) => {
      let sql = `
        SELECT f.*,
          r.status AS last_run_status,
          r.created_at AS last_run_at,
          r.elapsed_ms AS last_run_elapsed
        FROM qa_test_flows f
        LEFT JOIN LATERAL (
          SELECT status, created_at, elapsed_ms
          FROM qa_test_results
          WHERE flow_id = f.id
          ORDER BY created_at DESC
          LIMIT 1
        ) r ON true
        WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;

      if (args.enabled_only !== false) {
        sql += ` AND f.enabled = true`;
      }
      if (args.domain) {
        sql += ` AND f.domain = $${idx++}`;
        params.push(args.domain);
      }
      if (args.tags && args.tags.length > 0) {
        sql += ` AND f.tags && $${idx++}`;
        params.push(args.tags);
      }

      sql += ` ORDER BY f.domain NULLS LAST, f.name`;
      const result = await query(sql, params);

      return {
        flows: result.rows.map((f: any) => ({
          id: f.id,
          name: f.name,
          description: f.description,
          domain: f.domain,
          tags: f.tags,
          steps_count: Array.isArray(f.steps) ? f.steps.length : 0,
          preconditions: f.preconditions,
          enabled: f.enabled,
          last_run_status: f.last_run_status || 'never',
          last_run_at: f.last_run_at || null,
          last_run_elapsed: f.last_run_elapsed || null,
        })),
        count: result.rows.length,
      };
    },
  },

  qa_delete_test_flow: {
    description: `[QA Agent] Delete a test flow by name or ID. Also removes associated test results.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Flow name' },
        id: { type: 'number', description: 'Flow ID' },
      },
    },
    handler: async (args: any) => {
      if (!args.name && !args.id) {
        return { error: 'Provide either name or id' };
      }

      // Find the flow
      const findSql = args.id
        ? 'SELECT id, name FROM qa_test_flows WHERE id = $1'
        : 'SELECT id, name FROM qa_test_flows WHERE name = $1';
      const findResult = await query(findSql, [args.id || args.name]);

      if (findResult.rows.length === 0) {
        return { error: `Flow not found: ${args.name || args.id}` };
      }

      const flowId = findResult.rows[0].id;
      const flowName = findResult.rows[0].name;

      // Delete results first, then flow
      const delResults = await query('DELETE FROM qa_test_results WHERE flow_id = $1', [flowId]);
      await query('DELETE FROM qa_test_flows WHERE id = $1', [flowId]);

      return {
        success: true,
        deleted_flow: flowName,
        deleted_results: delResults.rowCount || 0,
      };
    },
  },

  qa_run_test_flow: {
    description: `[QA Agent] Execute a saved browser test flow. Launches browser if needed, resolves templates, runs preconditions, executes steps with assertions, takes screenshots on failure, and saves results to DB.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        flow_name: { type: 'string', description: 'Flow name to run' },
        flow_id: { type: 'number', description: 'Flow ID to run' },
        test_data_overrides: { type: 'object', description: 'Override template variables at runtime' },
        take_screenshots: { type: 'boolean', description: 'Take screenshot on each step (default: false)' },
        headless: { type: 'boolean', description: 'Run browser headless (default: true)' },
        suite_id: { type: 'number', description: 'Suite ID (set internally when run from suite)' },
      },
      required: [],
    },
    handler: async (args: any): Promise<any> => {
      // 1. Load flow
      const findSql = args.flow_id
        ? 'SELECT * FROM qa_test_flows WHERE id = $1'
        : 'SELECT * FROM qa_test_flows WHERE name = $1';
      const findResult = await query(findSql, [args.flow_id || args.flow_name]);

      if (findResult.rows.length === 0) {
        return { error: `Flow not found: ${args.flow_name || args.flow_id}` };
      }

      const flow = findResult.rows[0];
      const testData = { ...(flow.test_data || {}), ...(args.test_data_overrides || {}) };
      const headless = args.headless !== false;

      // 2. Ensure browser session
      try {
        await browserTools.browser_get_state.handler({});
      } catch {
        // No active session — launch one
        await browserTools.browser_launch.handler({ headless, url: 'http://localhost:3003' });
      }

      // 3. Run preconditions (with cycle detection + suite satisfaction tracking)
      const preconditions: string[] = flow.preconditions || [];
      const executedPreconditions: string[] = [];
      const satisfiedPreconditions: string[] = args._satisfied_preconditions || [];

      for (const preFlowName of preconditions) {
        if (preFlowName === flow.name) continue; // self-reference guard

        // Skip preconditions already satisfied in the current suite session
        if (satisfiedPreconditions.includes(preFlowName)) {
          executedPreconditions.push(preFlowName);
          continue;
        }

        const preResult = await tools.qa_run_test_flow.handler({
          flow_name: preFlowName,
          test_data_overrides: testData,
          headless,
          _executed_chain: [...(args._executed_chain || []), flow.name],
          _satisfied_preconditions: satisfiedPreconditions,
          suite_id: args.suite_id,
        });
        if (preResult.error || preResult.status === 'failed' || preResult.status === 'error') {
          // Save skipped result
          await query(
            `INSERT INTO qa_test_results (flow_id, suite_id, flow_name, status, total_steps, passed_steps, failed_steps, elapsed_ms, step_results, error_message, test_data_used)
             VALUES ($1, $2, $3, 'skipped', $4, 0, 0, 0, '[]', $5, $6)`,
            [flow.id, args.suite_id || null, flow.name, flow.steps.length,
             `Precondition "${preFlowName}" failed: ${preResult.error || preResult.error_message || 'FAILED'}`,
             JSON.stringify(testData)],
          );
          return {
            flow: flow.name,
            status: 'skipped',
            error_message: `Precondition "${preFlowName}" failed`,
            precondition_result: preResult,
          };
        }
        executedPreconditions.push(preFlowName);
      }

      // 4. Resolve templates in steps
      const resolvedSteps = resolveTemplates(flow.steps, testData);

      // 5. Execute steps
      const stepResults: any[] = [];
      const startTime = Date.now();
      let lastError: string | null = null;
      let screenshotOnFailure: string | null = null;

      for (let i = 0; i < resolvedSteps.length; i++) {
        const step = resolvedSteps[i];
        const stepStart = Date.now();
        const stepResult: any = {
          step: i + 1,
          label: step.label || `${step.action} ${step.selector || step.value || ''}`.trim(),
          action: step.action,
          status: 'passed',
          elapsed_ms: 0,
        };

        try {
          // Execute action via browser tools
          switch (step.action) {
            case 'navigate':
              await browserTools.browser_navigate.handler({ url: step.value || step.selector, wait_until: 'domcontentloaded' });
              break;
            case 'click':
            case 'fill':
            case 'select':
            case 'check':
            case 'press':
            case 'clear':
            case 'hover':
              await browserTools.browser_action.handler({ action: step.action, selector: step.selector, value: step.value, timeout: step.timeout || 5000 });
              break;
            case 'wait':
              await browserTools.browser_wait.handler({ type: step.value === 'selector' || step.selector ? 'selector' : 'timeout', value: step.selector || step.value || '1000', timeout: step.timeout || 10000 });
              break;
            case 'screenshot':
              await browserTools.browser_screenshot.handler({ full_page: step.value === 'full' });
              break;
            case 'evaluate':
              const evalResult = await browserTools.browser_evaluate.handler({ script: step.value || '' });
              stepResult.eval_result = evalResult.result;
              break;
          }

          if (step.wait_after) {
            await browserTools.browser_wait.handler({ type: 'timeout', value: String(step.wait_after) });
          }

          // 6. Run assertion if present
          if (step.assertion) {
            const assertionResult = await runAssertion(step.assertion);
            if (!assertionResult.passed) {
              stepResult.status = 'failed';
              stepResult.assertion_error = assertionResult.message;
              lastError = `Step ${i + 1} assertion failed: ${assertionResult.message}`;
            } else {
              stepResult.assertion_passed = true;
            }
          }

          // Optional screenshot per step
          if (args.take_screenshots && step.action !== 'screenshot') {
            try {
              const ssResult = await browserTools.browser_screenshot.handler({});
              if (ssResult.content) {
                const imgContent = ssResult.content.find((c: any) => c.type === 'image');
                if (imgContent) stepResult.screenshot = imgContent.data.slice(0, 200) + '...';
              }
            } catch {}
          }
        } catch (e: any) {
          stepResult.status = 'failed';
          stepResult.error = e.message;
          lastError = `Step ${i + 1} error: ${e.message}`;

          // Screenshot on failure
          try {
            const ssResult = await browserTools.browser_screenshot.handler({});
            if (ssResult.content) {
              const imgContent = ssResult.content.find((c: any) => c.type === 'image');
              if (imgContent) screenshotOnFailure = imgContent.data;
            }
          } catch {}
        }

        stepResult.elapsed_ms = Date.now() - stepStart;
        stepResults.push(stepResult);

        // Stop on first failure
        if (stepResult.status === 'failed') break;
      }

      const elapsed = Date.now() - startTime;
      const passedSteps = stepResults.filter(s => s.status === 'passed').length;
      const failedSteps = stepResults.filter(s => s.status === 'failed').length;

      // Check expected URL
      let finalUrl = '';
      try {
        const state = await browserTools.browser_get_state.handler({});
        finalUrl = state.url || '';
      } catch {}

      let status: string;
      if (failedSteps > 0) {
        status = 'failed';
      } else if (flow.expected_url && !finalUrl.includes(flow.expected_url)) {
        status = 'failed';
        lastError = `Expected URL to contain "${flow.expected_url}" but got "${finalUrl}"`;
      } else {
        status = 'passed';
      }

      // 7. Save result to DB
      await query(
        `INSERT INTO qa_test_results (flow_id, suite_id, flow_name, status, total_steps, passed_steps, failed_steps, elapsed_ms, step_results, error_message, screenshot_on_failure, final_url, test_data_used, environment)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          flow.id,
          args.suite_id || null,
          flow.name,
          status,
          resolvedSteps.length,
          passedSteps,
          failedSteps,
          elapsed,
          JSON.stringify(stepResults),
          lastError,
          screenshotOnFailure ? screenshotOnFailure.slice(0, 50000) : null, // cap size
          finalUrl,
          JSON.stringify(testData),
          JSON.stringify({ headless, preconditions: executedPreconditions }),
        ],
      );

      return {
        flow: flow.name,
        status,
        total_steps: resolvedSteps.length,
        passed_steps: passedSteps,
        failed_steps: failedSteps,
        elapsed_ms: elapsed,
        final_url: finalUrl,
        error_message: lastError,
        step_results: stepResults,
      };
    },
  },

  qa_save_test_suite: {
    description: `[QA Agent] Save (upsert) a test suite — a named group of test flows to run together.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Suite name' },
        description: { type: 'string' },
        flow_names: { type: 'array', items: { type: 'string' }, description: 'Ordered list of flow names to include' },
        setup_flow: { type: 'string', description: 'Flow name to run before suite (e.g. "Login Admin")' },
        teardown_flow: { type: 'string', description: 'Flow name to run after suite (e.g. "Logout")' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['name', 'flow_names'],
    },
    handler: async (args: any) => {
      // Resolve flow names to IDs
      const flowIds: number[] = [];
      const notFound: string[] = [];
      for (const name of args.flow_names) {
        const r = await query('SELECT id FROM qa_test_flows WHERE name = $1', [name]);
        if (r.rows.length > 0) {
          flowIds.push(r.rows[0].id);
        } else {
          notFound.push(name);
        }
      }
      if (notFound.length > 0) {
        return { error: `Flows not found: ${notFound.join(', ')}` };
      }

      let setupId: number | null = null;
      let teardownId: number | null = null;

      if (args.setup_flow) {
        const r = await query('SELECT id FROM qa_test_flows WHERE name = $1', [args.setup_flow]);
        if (r.rows.length === 0) return { error: `Setup flow not found: ${args.setup_flow}` };
        setupId = r.rows[0].id;
      }
      if (args.teardown_flow) {
        const r = await query('SELECT id FROM qa_test_flows WHERE name = $1', [args.teardown_flow]);
        if (r.rows.length === 0) return { error: `Teardown flow not found: ${args.teardown_flow}` };
        teardownId = r.rows[0].id;
      }

      const result = await query(
        `INSERT INTO qa_test_suites (name, description, flow_ids, setup_flow_id, teardown_flow_id, tags)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (name) DO UPDATE SET
           description = EXCLUDED.description,
           flow_ids = EXCLUDED.flow_ids,
           setup_flow_id = EXCLUDED.setup_flow_id,
           teardown_flow_id = EXCLUDED.teardown_flow_id,
           tags = EXCLUDED.tags
         RETURNING id, (xmax = 0) AS is_new`,
        [args.name, args.description || null, flowIds, setupId, teardownId, args.tags || []],
      );

      const row = result.rows[0];
      return {
        success: true,
        id: row.id,
        action: row.is_new ? 'created' : 'updated',
        name: args.name,
        flow_count: flowIds.length,
      };
    },
  },

  qa_run_test_suite: {
    description: `[QA Agent] Execute all flows in a test suite sequentially. Runs setup flow first, then all flows, then teardown. Saves individual results per flow.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        suite_name: { type: 'string', description: 'Suite name' },
        suite_id: { type: 'number', description: 'Suite ID' },
        stop_on_failure: { type: 'boolean', description: 'Stop at first failure (default: false)' },
        headless: { type: 'boolean', description: 'Run headless (default: true)' },
      },
    },
    handler: async (args: any) => {
      const findSql = args.suite_id
        ? 'SELECT * FROM qa_test_suites WHERE id = $1'
        : 'SELECT * FROM qa_test_suites WHERE name = $1';
      const findResult = await query(findSql, [args.suite_id || args.suite_name]);

      if (findResult.rows.length === 0) {
        return { error: `Suite not found: ${args.suite_name || args.suite_id}` };
      }

      const suite = findResult.rows[0];
      const headless = args.headless !== false;
      const stopOnFailure = args.stop_on_failure || false;
      const suiteStart = Date.now();
      const flowResults: any[] = [];
      // Track flows that have passed in this suite session — used to skip redundant preconditions
      const satisfiedFlows: string[] = [];

      // Load flow names from IDs
      const flowsResult = await query(
        'SELECT id, name FROM qa_test_flows WHERE id = ANY($1) ORDER BY array_position($1, id)',
        [suite.flow_ids],
      );
      const flows = flowsResult.rows;

      // Run setup flow
      if (suite.setup_flow_id) {
        const setupResult = await query('SELECT name FROM qa_test_flows WHERE id = $1', [suite.setup_flow_id]);
        if (setupResult.rows.length > 0) {
          const setupFlowName = setupResult.rows[0].name;
          const r = await tools.qa_run_test_flow.handler({
            flow_name: setupFlowName,
            headless,
            suite_id: suite.id,
            _satisfied_preconditions: satisfiedFlows,
          });
          flowResults.push({ type: 'setup', ...r });
          if (r.status === 'passed') {
            satisfiedFlows.push(setupFlowName);
          }
          if ((r.status === 'failed' || r.status === 'error') && stopOnFailure) {
            return { suite: suite.name, status: 'failed', reason: 'Setup failed', results: flowResults, elapsed_ms: Date.now() - suiteStart };
          }
        }
      }

      // Run flows
      let aborted = false;
      for (const flow of flows) {
        if (aborted) {
          flowResults.push({ type: 'flow', flow: flow.name, status: 'skipped' });
          continue;
        }
        const r = await tools.qa_run_test_flow.handler({
          flow_name: flow.name,
          headless,
          suite_id: suite.id,
          _satisfied_preconditions: satisfiedFlows,
        });
        flowResults.push({ type: 'flow', ...r });
        if (r.status === 'passed') {
          satisfiedFlows.push(flow.name);
        }
        if ((r.status === 'failed' || r.status === 'error') && stopOnFailure) {
          aborted = true;
        }
      }

      // Run teardown flow
      if (suite.teardown_flow_id) {
        const teardownResult = await query('SELECT name FROM qa_test_flows WHERE id = $1', [suite.teardown_flow_id]);
        if (teardownResult.rows.length > 0) {
          const r = await tools.qa_run_test_flow.handler({
            flow_name: teardownResult.rows[0].name,
            headless,
            suite_id: suite.id,
            _satisfied_preconditions: satisfiedFlows,
          });
          flowResults.push({ type: 'teardown', ...r });
        }
      }

      const elapsed = Date.now() - suiteStart;
      const passed = flowResults.filter(r => r.status === 'passed').length;
      const failed = flowResults.filter(r => r.status === 'failed' || r.status === 'error').length;
      const skipped = flowResults.filter(r => r.status === 'skipped').length;

      return {
        suite: suite.name,
        status: failed === 0 ? 'passed' : 'failed',
        total_flows: flowResults.length,
        passed,
        failed,
        skipped,
        elapsed_ms: elapsed,
        results: flowResults,
      };
    },
  },

  qa_get_test_results: {
    description: `[QA Agent] Query test execution history with filters.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        flow_name: { type: 'string', description: 'Filter by flow name' },
        suite_name: { type: 'string', description: 'Filter by suite name' },
        status: { type: 'string', enum: ['passed', 'failed', 'error', 'skipped'], description: 'Filter by status' },
        limit: { type: 'number', description: 'Max results (default: 20)' },
        since: { type: 'string', description: 'ISO date — only results after this date' },
      },
    },
    handler: async (args: any) => {
      let sql = `SELECT r.*, s.name AS suite_name
                 FROM qa_test_results r
                 LEFT JOIN qa_test_suites s ON s.id = r.suite_id
                 WHERE 1=1`;
      const params: any[] = [];
      let idx = 1;

      if (args.flow_name) {
        sql += ` AND r.flow_name = $${idx++}`;
        params.push(args.flow_name);
      }
      if (args.suite_name) {
        sql += ` AND s.name = $${idx++}`;
        params.push(args.suite_name);
      }
      if (args.status) {
        sql += ` AND r.status = $${idx++}`;
        params.push(args.status);
      }
      if (args.since) {
        sql += ` AND r.created_at >= $${idx++}`;
        params.push(args.since);
      }

      sql += ` ORDER BY r.created_at DESC LIMIT $${idx}`;
      params.push(args.limit || 20);

      const result = await query(sql, params);

      return {
        results: result.rows.map((r: any) => ({
          id: r.id,
          flow_name: r.flow_name,
          suite_name: r.suite_name || null,
          status: r.status,
          total_steps: r.total_steps,
          passed_steps: r.passed_steps,
          failed_steps: r.failed_steps,
          elapsed_ms: r.elapsed_ms,
          error_message: r.error_message,
          final_url: r.final_url,
          created_at: r.created_at,
        })),
        count: result.rows.length,
      };
    },
  },

  qa_test_report: {
    description: `[QA Agent] Generate an aggregated QA test report with pass rates, trends, most-failing flows, and coverage metrics.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'all'], description: 'Time period (default: week)' },
        domain: { type: 'string', description: 'Filter by domain' },
      },
    },
    handler: async (args: any) => {
      const period = args.period || 'week';
      let dateFilter = '';
      switch (period) {
        case 'today': dateFilter = "AND r.created_at >= CURRENT_DATE"; break;
        case 'week': dateFilter = "AND r.created_at >= CURRENT_DATE - INTERVAL '7 days'"; break;
        case 'month': dateFilter = "AND r.created_at >= CURRENT_DATE - INTERVAL '30 days'"; break;
        case 'all': dateFilter = ''; break;
      }

      const domainJoin = args.domain ? 'JOIN qa_test_flows f ON f.id = r.flow_id AND f.domain = $1' : '';
      const domainParams = args.domain ? [args.domain] : [];

      // Overall stats
      const statsResult = await query(
        `SELECT
           COUNT(*) AS total_runs,
           COUNT(*) FILTER (WHERE r.status = 'passed') AS passed,
           COUNT(*) FILTER (WHERE r.status = 'failed') AS failed,
           COUNT(*) FILTER (WHERE r.status = 'error') AS errors,
           COUNT(*) FILTER (WHERE r.status = 'skipped') AS skipped,
           ROUND(AVG(r.elapsed_ms)) AS avg_duration_ms,
           ROUND(100.0 * COUNT(*) FILTER (WHERE r.status = 'passed') / NULLIF(COUNT(*), 0), 1) AS pass_rate
         FROM qa_test_results r
         ${domainJoin}
         WHERE 1=1 ${dateFilter}`,
        domainParams,
      );

      // Most failing flows
      const failingResult = await query(
        `SELECT r.flow_name, COUNT(*) AS failures
         FROM qa_test_results r
         ${domainJoin}
         WHERE r.status = 'failed' ${dateFilter}
         GROUP BY r.flow_name
         ORDER BY failures DESC
         LIMIT 10`,
        domainParams,
      );

      // Daily trend
      const trendResult = await query(
        `SELECT
           DATE(r.created_at) AS day,
           COUNT(*) AS total,
           COUNT(*) FILTER (WHERE r.status = 'passed') AS passed,
           COUNT(*) FILTER (WHERE r.status = 'failed') AS failed
         FROM qa_test_results r
         ${domainJoin}
         WHERE 1=1 ${dateFilter}
         GROUP BY DATE(r.created_at)
         ORDER BY day DESC
         LIMIT 30`,
        domainParams,
      );

      // Flows never run
      const neverRunResult = await query(
        `SELECT f.name, f.domain
         FROM qa_test_flows f
         WHERE f.enabled = true
         ${args.domain ? 'AND f.domain = $1' : ''}
         AND NOT EXISTS (SELECT 1 FROM qa_test_results r WHERE r.flow_id = f.id)
         ORDER BY f.name`,
        domainParams,
      );

      const stats = statsResult.rows[0] || {};

      return {
        period,
        domain: args.domain || 'all',
        summary: {
          total_runs: parseInt(stats.total_runs) || 0,
          passed: parseInt(stats.passed) || 0,
          failed: parseInt(stats.failed) || 0,
          errors: parseInt(stats.errors) || 0,
          skipped: parseInt(stats.skipped) || 0,
          pass_rate: parseFloat(stats.pass_rate) || 0,
          avg_duration_ms: parseInt(stats.avg_duration_ms) || 0,
        },
        most_failing: failingResult.rows,
        daily_trend: trendResult.rows,
        never_run: neverRunResult.rows,
        never_run_count: neverRunResult.rows.length,
      };
    },
  },

  // ==========================================================================
  // QA SMOKE TEST TOOLS (Internal API)
  // ==========================================================================

  qa_smoke_sales: {
    description: `[QA Agent] Smoke test de ventas — verifica que existan ventas y que el revenue sea positivo vía Internal API.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/sales/statistics');
      if (!res.ok) {
        return { status: 'error', error: `API error ${res.status}`, data: res.data };
      }
      const data = res.data;
      const checks: { name: string; passed: boolean; detail: string }[] = [];

      const salesCount = data.totalSales ?? data.count ?? data.total ?? 0;
      checks.push({
        name: 'sales_count_positive',
        passed: salesCount > 0,
        detail: `Total sales: ${salesCount}`,
      });

      const revenue = data.totalRevenue ?? data.revenue ?? data.totalAmount ?? 0;
      checks.push({
        name: 'revenue_positive',
        passed: revenue > 0,
        detail: `Revenue: ${revenue}`,
      });

      const allPassed = checks.every((c) => c.passed);
      return {
        status: allPassed ? 'passed' : 'failed',
        checks,
        raw: data,
      };
    },
  },

  qa_smoke_inventory: {
    description: `[QA Agent] Smoke test de inventario — verifica si hay productos con stock negativo vía Internal API.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/inventory/items');
      if (!res.ok) {
        return { status: 'error', error: `API error ${res.status}`, data: res.data };
      }
      const items = Array.isArray(res.data) ? res.data : (res.data?.items ?? []);
      const negativeStock = items.filter((i: any) => (i.stock ?? i.quantity ?? 0) < 0);

      const checks: { name: string; passed: boolean; detail: string }[] = [];
      checks.push({
        name: 'no_negative_stock',
        passed: negativeStock.length === 0,
        detail: negativeStock.length === 0
          ? 'No items with negative stock'
          : `${negativeStock.length} items with negative stock`,
      });

      return {
        status: negativeStock.length === 0 ? 'passed' : 'failed',
        checks,
        negative_stock_items: negativeStock.slice(0, 10),
        total_items: items.length,
      };
    },
  },

  qa_smoke_shipments: {
    description: `[QA Agent] Smoke test de envíos — verifica si hay envíos pendientes con más de 30 días vía Internal API.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/shipments/pending');
      if (!res.ok) {
        return { status: 'error', error: `API error ${res.status}`, data: res.data };
      }
      const shipments = Array.isArray(res.data) ? res.data : (res.data?.items ?? []);
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const stale = shipments.filter((s: any) => {
        const created = new Date(s.createdAt ?? s.created_at ?? 0);
        return created < thirtyDaysAgo;
      });

      const checks: { name: string; passed: boolean; detail: string }[] = [];
      checks.push({
        name: 'no_stale_shipments',
        passed: stale.length === 0,
        detail: stale.length === 0
          ? 'No shipments pending > 30 days'
          : `${stale.length} shipments pending > 30 days`,
      });

      return {
        status: stale.length === 0 ? 'passed' : 'warning',
        checks,
        stale_shipments: stale.slice(0, 10),
        total_pending: shipments.length,
      };
    },
  },
};

// ==========================================================================
// Helpers for QA Browser Testing
// ==========================================================================

function resolveTemplates(steps: any[], testData: Record<string, string>): any[] {
  return steps.map(step => ({
    ...step,
    value: step.value?.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => testData[key] || ''),
    selector: step.selector?.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => testData[key] || ''),
  }));
}

async function runAssertion(assertion: { type: string; selector?: string; value?: string }): Promise<{ passed: boolean; message: string }> {
  try {
    switch (assertion.type) {
      case 'visible': {
        const state = await browserTools.browser_get_state.handler({ selector: assertion.selector });
        const found = state.elements && state.elements.length > 0;
        return { passed: found, message: found ? 'Element visible' : `Element not visible: ${assertion.selector}` };
      }
      case 'hidden': {
        const state = await browserTools.browser_get_state.handler({ selector: assertion.selector });
        const hidden = !state.elements || state.elements.length === 0;
        return { passed: hidden, message: hidden ? 'Element hidden' : `Element still visible: ${assertion.selector}` };
      }
      case 'text_contains': {
        const state = await browserTools.browser_get_state.handler({ include_text: true });
        const contains = state.text?.includes(assertion.value || '');
        return { passed: contains, message: contains ? 'Text found' : `Text "${assertion.value}" not found on page` };
      }
      case 'url_contains': {
        const state = await browserTools.browser_get_state.handler({});
        const contains = state.url?.includes(assertion.value || '');
        return { passed: contains, message: contains ? 'URL matches' : `URL "${state.url}" does not contain "${assertion.value}"` };
      }
      case 'eval_truthy': {
        const result = await browserTools.browser_evaluate.handler({ script: assertion.value || 'false' });
        const truthy = !!result.result;
        return { passed: truthy, message: truthy ? 'Eval truthy' : `Eval returned falsy: ${JSON.stringify(result.result)}` };
      }
      default:
        return { passed: false, message: `Unknown assertion type: ${assertion.type}` };
    }
  } catch (e: any) {
    return { passed: false, message: `Assertion error: ${e.message}` };
  }
}
