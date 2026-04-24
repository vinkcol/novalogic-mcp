import { execSync } from 'child_process';
import { query } from '../../../db/client.js';
import { safeRead, listDir, existsSync, join } from '../../../shared/fs-helpers.js';
import { PROJECT_ROOT, MCP_ROOT } from '../../../shared/constants.js';

function safeExec(cmd: string, cwd?: string, timeoutMs = 15000): string | null {
  try {
    return execSync(cmd, {
      cwd: cwd || PROJECT_ROOT,
      timeout: timeoutMs,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch (error: any) {
    return error.stdout?.trim() || error.stderr?.trim() || null;
  }
}

// ─── Infrastructure Map ─────────────────────────────────────────────────────
const INFRA_MAP = {
  api: {
    path: 'api',
    compose: 'api/docker-compose.yml',
    composeProd: 'api/docker-compose.prod.yml',
    dockerfile: 'api/Dockerfile',
    envExample: 'api/.env.example',
    port: 3005,
    description: 'NestJS 11 API (TypeScript, TypeORM, PostgreSQL)',
  },
  dashboard: {
    path: 'dashboard',
    composeProd: 'dashboard/docker-compose.prod.yml',
    dockerfile: 'dashboard/Dockerfile',
    port: 3000,
    description: 'React 18 SPA (Vite 5, Nginx in production)',
  },
  mcp: {
    path: 'novalogic-mcp',
    compose: 'novalogic-mcp/docker-compose.yml',
    dockerfile: 'novalogic-mcp/Dockerfile',
    envExample: 'novalogic-mcp/.env.example',
    description: 'MCP Server (PostgreSQL pgvector + Redis + MongoDB)',
  },
} as const;

const SERVICES = {
  'postgres-api': {
    container: 'novalogic-postgres-n',
    image: 'pgvector/pgvector:pg16',
    ports: { host: 5436, container: 5432 },
    compose: 'api/docker-compose.yml',
    description: 'API PostgreSQL database (pgvector)',
  },
  'postgres-mcp': {
    container: 'novalogic-mcp-db',
    image: 'pgvector/pgvector:pg17',
    ports: { host: 5433, container: 5432 },
    compose: 'novalogic-mcp/docker-compose.yml',
    description: 'MCP PostgreSQL database (pgvector, semantic memory)',
  },
  'redis-mcp': {
    container: 'novalogic-mcp-redis',
    image: 'redis:7-alpine',
    ports: { host: 6380, container: 6379 },
    compose: 'novalogic-mcp/docker-compose.yml',
    description: 'MCP Redis cache',
  },
  'mongo-mcp': {
    container: 'novalogic-mcp-mongo',
    image: 'mongo:7',
    ports: { host: 27018, container: 27017 },
    compose: 'novalogic-mcp/docker-compose.yml',
    description: 'MCP MongoDB for business process documents',
  },
  rabbitmq: {
    container: 'novalogic-rabbitmq-n',
    image: 'rabbitmq:3-management',
    ports: { host: 5673, container: 5672 },
    compose: 'api/docker-compose.yml',
    description: 'Message broker (AMQP + management UI on :15673)',
  },
  nginx: {
    container: 'nginx-proxy',
    image: 'nginx:alpine',
    ports: { host: 80, container: 80 },
    compose: 'api/docker-compose.prod.yml',
    description: 'Reverse proxy (production only, with SSL/certbot)',
  },
} as const;

// ─── Tools Export ────────────────────────────────────────────────────────────

export const tools = {
  // ── 1. Infrastructure Overview ──────────────────────────────────────────
  devops_get_infra: {
    description:
      '[DevOps Agent] Get complete infrastructure overview — all Docker services, compose files, Dockerfiles, ports, environment config, and current container status. The starting point for any infra task.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        check_status: {
          type: 'boolean',
          description: 'Run docker ps to check live container status (default true)',
        },
      },
    },
    handler: async (args: any) => {
      const checkStatus = args.check_status !== false;

      // Collect compose files
      const composeFiles: Record<string, any> = {};
      for (const [name, svc] of Object.entries(INFRA_MAP)) {
        const files: Record<string, string | null> = {};
        if ('compose' in svc && svc.compose) {
          files['docker-compose.yml'] = safeRead(join(PROJECT_ROOT, svc.compose)) ? 'exists' : 'missing';
        }
        if ('composeProd' in svc && svc.composeProd) {
          files['docker-compose.prod.yml'] = safeRead(join(PROJECT_ROOT, svc.composeProd)) ? 'exists' : 'missing';
        }
        files['Dockerfile'] = existsSync(join(PROJECT_ROOT, svc.dockerfile)) ? 'exists' : 'missing';
        composeFiles[name] = { ...svc, files };
      }

      // Container status
      let containers: string | null = null;
      if (checkStatus) {
        containers = safeExec('docker ps -a --format "table {{.Names}}\\t{{.Status}}\\t{{.Ports}}\\t{{.Image}}"');
      }

      // Port allocation
      const portMap = Object.entries(SERVICES).map(([name, svc]) => ({
        service: name,
        hostPort: svc.ports.host,
        containerPort: svc.ports.container,
        container: svc.container,
      }));

      // Env files
      const envFiles: Record<string, boolean> = {};
      for (const envFile of ['api/.env', 'api/.env.example', 'api/.env.production', 'novalogic-mcp/.env', 'novalogic-mcp/.env.example', 'dashboard/.env']) {
        envFiles[envFile] = existsSync(join(PROJECT_ROOT, envFile));
      }

      return {
        services: SERVICES,
        applications: composeFiles,
        portAllocation: portMap,
        envFiles,
        containers: containers || 'Docker not available or no containers running',
      };
    },
  },

  // ── 2. Docker Compose Operations ────────────────────────────────────────
  devops_compose_status: {
    description:
      '[DevOps Agent] Check Docker Compose status for a specific stack (api, mcp, or dashboard). Returns service health, logs, and resource usage.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        stack: {
          type: 'string',
          description: 'Stack name: "api", "mcp", or "dashboard"',
        },
        include_logs: {
          type: 'boolean',
          description: 'Include last 30 lines of logs (default false)',
        },
      },
      required: ['stack'],
    },
    handler: async (args: any) => {
      const stack = args.stack as string;

      const composePaths: Record<string, string> = {
        api: join(PROJECT_ROOT, 'api'),
        mcp: MCP_ROOT,
        dashboard: join(PROJECT_ROOT, 'dashboard'),
      };

      const cwd = composePaths[stack];
      if (!cwd || !existsSync(cwd)) {
        return { error: `Unknown stack: ${stack}`, available: Object.keys(composePaths) };
      }

      const hasCompose = existsSync(join(cwd, 'docker-compose.yml'));
      const hasComposeProd = existsSync(join(cwd, 'docker-compose.prod.yml'));

      if (!hasCompose && !hasComposeProd) {
        return { error: `No docker-compose file found in ${stack}/`, path: cwd };
      }

      const status = safeExec('docker compose ps -a --format json', cwd);
      const logs = args.include_logs
        ? safeExec('docker compose logs --tail=30 --no-color', cwd)
        : null;

      // Read compose file
      const composeContent = safeRead(join(cwd, 'docker-compose.yml'))
        || safeRead(join(cwd, 'docker-compose.prod.yml'));

      return {
        stack,
        path: cwd,
        composeFiles: {
          'docker-compose.yml': hasCompose,
          'docker-compose.prod.yml': hasComposeProd,
        },
        status: status || 'No containers running or Docker not available',
        logs: logs || undefined,
        composeContent: composeContent || 'Could not read compose file',
      };
    },
  },

  // ── 3. Dockerfile Inspector ─────────────────────────────────────────────
  devops_get_dockerfile: {
    description:
      '[DevOps Agent] Read and analyze Dockerfiles — returns the content, build stages, base images, exposed ports, and potential improvements.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          description: 'Target: "api", "dashboard", or "mcp"',
        },
      },
      required: ['target'],
    },
    handler: async (args: any) => {
      const target = args.target as string;
      const infraEntry = INFRA_MAP[target as keyof typeof INFRA_MAP];
      if (!infraEntry) {
        return { error: `Unknown target: ${target}`, available: Object.keys(INFRA_MAP) };
      }

      const dockerfilePath = join(PROJECT_ROOT, infraEntry.dockerfile);
      const content = safeRead(dockerfilePath);
      if (!content) {
        return { error: `Dockerfile not found at ${dockerfilePath}` };
      }

      // Parse Dockerfile
      const stages = content.match(/^FROM\s+.+/gm) || [];
      const exposes = content.match(/^EXPOSE\s+.+/gm) || [];
      const cmds = content.match(/^(CMD|ENTRYPOINT)\s+.+/gm) || [];
      const healthchecks = content.match(/^HEALTHCHECK\s+.+/gm) || [];
      const copyFromBuild = content.match(/COPY\s+--from=\w+.+/gm) || [];

      // Check for compose file
      const composePath = 'compose' in infraEntry && infraEntry.compose
        ? join(PROJECT_ROOT, infraEntry.compose)
        : null;
      const composeContent = composePath ? safeRead(composePath) : null;

      return {
        target,
        path: dockerfilePath,
        content,
        analysis: {
          stages: stages.map((s) => s.trim()),
          exposedPorts: exposes.map((e) => e.trim()),
          commands: cmds.map((c) => c.trim()),
          healthchecks: healthchecks.map((h) => h.trim()),
          multiStage: stages.length > 1,
          copyFromBuild: copyFromBuild.map((c) => c.trim()),
        },
        composeContent: composeContent || undefined,
      };
    },
  },

  // ── 4. Environment Config ───────────────────────────────────────────────
  devops_get_env: {
    description:
      '[DevOps Agent] Inspect environment configuration — reads .env.example files (never actual .env), validates required vars, and checks for missing config. Safe to use — never exposes secrets.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          description: 'Target: "api", "mcp", or "all"',
        },
      },
      required: ['target'],
    },
    handler: async (args: any) => {
      const target = args.target as string;
      const results: Record<string, any> = {};

      const targets = target === 'all' ? ['api', 'mcp'] : [target];

      for (const t of targets) {
        const basePath = t === 'mcp' ? MCP_ROOT : join(PROJECT_ROOT, t);
        const examplePath = join(basePath, '.env.example');
        const envPath = join(basePath, '.env');
        const envProdPath = join(basePath, '.env.production');

        const exampleContent = safeRead(examplePath);
        const hasEnv = existsSync(envPath);
        const hasProdEnv = existsSync(envProdPath);

        // Parse example vars (only from .env.example — safe)
        const exampleVars: Record<string, string> = {};
        if (exampleContent) {
          for (const line of exampleContent.split('\n')) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            const eqIdx = trimmed.indexOf('=');
            if (eqIdx === -1) continue;
            const key = trimmed.slice(0, eqIdx).trim();
            const value = trimmed.slice(eqIdx + 1).trim();
            exampleVars[key] = value;
          }
        }

        // Categorize vars
        const categories: Record<string, string[]> = {};
        for (const key of Object.keys(exampleVars)) {
          let cat = 'other';
          if (key.startsWith('DB_') || key.startsWith('DATABASE')) cat = 'database';
          else if (key.startsWith('JWT_') || key.includes('SECRET')) cat = 'security';
          else if (key.startsWith('SMTP_') || key.includes('MAIL')) cat = 'mail';
          else if (key.includes('CLOUDINARY') || key.includes('WOMPI')) cat = 'external_services';
          else if (key.startsWith('AI_')) cat = 'ai';
          else if (key.startsWith('COOKIE_')) cat = 'cookies';
          else if (key.startsWith('POSTGRES_') || key.startsWith('REDIS_')) cat = 'database';
          else if (key.startsWith('OLLAMA_') || key.startsWith('EMBEDDING_')) cat = 'embeddings';
          else if (key === 'NODE_ENV' || key === 'PORT' || key.includes('URL')) cat = 'runtime';
          if (!categories[cat]) categories[cat] = [];
          categories[cat].push(key);
        }

        results[t] = {
          exampleFile: exampleContent ? 'found' : 'missing',
          envFile: hasEnv ? 'exists (not reading — may contain secrets)' : 'MISSING',
          productionEnvFile: hasProdEnv ? 'exists' : 'not found',
          variables: exampleVars,
          categories,
          totalVars: Object.keys(exampleVars).length,
        };
      }

      return results;
    },
  },

  // ── 5. Port Scanner ─────────────────────────────────────────────────────
  devops_check_ports: {
    description:
      '[DevOps Agent] Check which Novalogic ports are in use — scans all known service ports and detects conflicts. Essential before starting services.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const knownPorts = [
        { port: 3000, service: 'Dashboard (dev)' },
        { port: 3003, service: 'Dashboard (alt dev)' },
        { port: 3005, service: 'API (dev)' },
        { port: 5432, service: 'PostgreSQL (default)' },
        { port: 5433, service: 'MCP PostgreSQL' },
        { port: 5435, service: 'API PostgreSQL (prod)' },
        { port: 5436, service: 'API PostgreSQL (dev compose)' },
        { port: 5672, service: 'RabbitMQ (default)' },
        { port: 5673, service: 'RabbitMQ (compose)' },
        { port: 6379, service: 'Redis (default)' },
        { port: 6380, service: 'MCP Redis' },
        { port: 27017, service: 'MongoDB (default)' },
        { port: 27018, service: 'MCP MongoDB' },
        { port: 11434, service: 'Ollama (embeddings)' },
        { port: 15672, service: 'RabbitMQ Management (default)' },
        { port: 15673, service: 'RabbitMQ Management (compose)' },
        { port: 80, service: 'Nginx (prod)' },
        { port: 443, service: 'Nginx SSL (prod)' },
      ];

      // Check which ports are listening
      const netstat = safeExec('netstat -ano | findstr LISTENING', undefined, 10000)
        || safeExec('ss -tlnp', undefined, 5000)
        || '';

      const portStatus = knownPorts.map((p) => {
        const regex = new RegExp(`:${p.port}\\s`, 'm');
        const inUse = regex.test(netstat);
        return { ...p, inUse };
      });

      const conflicts = portStatus.filter((p) => p.inUse);
      const available = portStatus.filter((p) => !p.inUse);

      return {
        portStatus,
        summary: {
          inUse: conflicts.map((c) => `${c.port} (${c.service})`),
          available: available.map((a) => `${a.port} (${a.service})`),
        },
      };
    },
  },

  // ── 6. Health Check ─────────────────────────────────────────────────────
  devops_health_check: {
    description:
      '[DevOps Agent] Run a health check on all Novalogic services — checks Docker daemon, containers, database connectivity, API endpoints, and disk usage.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const checks: Record<string, any> = {};

      // Docker daemon
      const dockerVersion = safeExec('docker version --format "{{.Server.Version}}"');
      checks.docker = {
        status: dockerVersion ? 'running' : 'not available',
        version: dockerVersion || null,
      };

      // Running containers
      const containers = safeExec('docker ps --format "{{.Names}}|{{.Status}}|{{.Image}}"');
      const novalogicContainers: Record<string, any> = {};
      if (containers) {
        for (const line of containers.split('\n')) {
          const [name, status, image] = line.split('|');
          if (name?.includes('novalogic') || name?.includes('nginx') || name?.includes('certbot')) {
            novalogicContainers[name] = { status, image, healthy: status?.includes('healthy') || status?.includes('Up') };
          }
        }
      }
      checks.containers = Object.keys(novalogicContainers).length > 0
        ? novalogicContainers
        : 'No Novalogic containers running';

      // Database connectivity (MCP DB)
      try {
        const dbResult = await query('SELECT 1 as ok, NOW() as server_time');
        checks.mcpDatabase = { status: 'connected', serverTime: dbResult.rows[0]?.server_time };
      } catch (error: any) {
        checks.mcpDatabase = { status: 'disconnected', error: error.message };
      }

      // Node.js
      const nodeVersion = safeExec('node --version');
      const npmVersion = safeExec('npm --version');
      checks.runtime = { node: nodeVersion, npm: npmVersion };

      // Disk usage (docker)
      const diskUsage = safeExec('docker system df --format "table {{.Type}}\\t{{.TotalCount}}\\t{{.Size}}\\t{{.Reclaimable}}"');
      checks.dockerDisk = diskUsage || 'Docker not available';

      // Project files integrity
      checks.projectFiles = {
        'api/package.json': existsSync(join(PROJECT_ROOT, 'api', 'package.json')),
        'api/Dockerfile': existsSync(join(PROJECT_ROOT, 'api', 'Dockerfile')),
        'dashboard/package.json': existsSync(join(PROJECT_ROOT, 'dashboard', 'package.json')),
        'dashboard/Dockerfile': existsSync(join(PROJECT_ROOT, 'dashboard', 'Dockerfile')),
        'novalogic-mcp/docker-compose.yml': existsSync(join(MCP_ROOT, 'docker-compose.yml')),
        'CLAUDE.md': existsSync(join(PROJECT_ROOT, 'CLAUDE.md')),
      };

      return checks;
    },
  },

  // ── 7. Container Logs ──────────────────────────────────────────────────
  devops_get_logs: {
    description:
      '[DevOps Agent] Get Docker container logs for a specific Novalogic service. Useful for debugging startup failures, crashes, or runtime errors.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        container: {
          type: 'string',
          description: 'Container name (e.g., "novalogic-api", "novalogic-mcp-db", "novalogic-postgres-n", "nginx-proxy") or stack name ("api", "mcp")',
        },
        lines: {
          type: 'number',
          description: 'Number of tail lines (default 50)',
        },
        since: {
          type: 'string',
          description: 'Show logs since (e.g., "10m", "1h", "2024-01-01")',
        },
      },
      required: ['container'],
    },
    handler: async (args: any) => {
      const target = args.container as string;
      const lines = args.lines || 50;
      const sinceFlag = args.since ? `--since ${args.since}` : '';

      // Check if it's a stack name or container name
      const stackPaths: Record<string, string> = {
        api: join(PROJECT_ROOT, 'api'),
        mcp: MCP_ROOT,
      };

      let logs: string | null;
      if (stackPaths[target]) {
        logs = safeExec(`docker compose logs --tail=${lines} --no-color ${sinceFlag}`, stackPaths[target], 30000);
      } else {
        logs = safeExec(`docker logs --tail=${lines} ${sinceFlag} ${target}`, undefined, 30000);
      }

      return {
        target,
        lines,
        logs: logs || 'No logs available — container may not exist or Docker is not running',
      };
    },
  },

  // ── 8. Database Inspector ───────────────────────────────────────────────
  devops_db_info: {
    description:
      '[DevOps Agent] Get database information — schema, tables, sizes, connections, and extensions. Works with the MCP database (pgvector). For the API database, returns connection config from env.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        target: {
          type: 'string',
          description: 'Database target: "mcp" (live query) or "api" (config only)',
        },
      },
      required: ['target'],
    },
    handler: async (args: any) => {
      const target = args.target as string;

      if (target === 'api') {
        // Just return config info — no direct connection to API DB
        const envExample = safeRead(join(PROJECT_ROOT, 'api', '.env.example'));
        const composeContent = safeRead(join(PROJECT_ROOT, 'api', 'docker-compose.yml'));

        return {
          target: 'api',
          note: 'API database config (not connected directly)',
          envExample: envExample || 'No .env.example found',
          composeConfig: composeContent || 'No docker-compose.yml found',
          connectionInfo: {
            host: 'localhost',
            port: 5436,
            database: 'novalogic_erp_n',
            user: 'novalogic',
            image: 'pgvector/pgvector:pg16',
          },
        };
      }

      if (target === 'mcp') {
        try {
          // Tables and sizes
          const tables = await query(`
            SELECT tablename,
                   pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) as size,
                   (SELECT count(*) FROM information_schema.columns WHERE table_name = tablename) as columns
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY pg_total_relation_size(quote_ident(tablename)) DESC
          `);

          // Row counts
          const rowCounts: Record<string, number> = {};
          for (const table of tables.rows) {
            try {
              const countResult = await query(`SELECT count(*) as count FROM ${table.tablename}`);
              rowCounts[table.tablename] = parseInt(countResult.rows[0].count, 10);
            } catch {
              rowCounts[table.tablename] = -1;
            }
          }

          // Extensions
          const extensions = await query("SELECT extname, extversion FROM pg_extension WHERE extname IN ('vector', 'pg_trgm')");

          // Connections
          const connections = await query('SELECT count(*) as active FROM pg_stat_activity');

          // DB size
          const dbSize = await query("SELECT pg_size_pretty(pg_database_size(current_database())) as size");

          return {
            target: 'mcp',
            database: 'novalogic_mcp',
            size: dbSize.rows[0]?.size,
            activeConnections: parseInt(connections.rows[0]?.active, 10),
            extensions: extensions.rows,
            tables: tables.rows.map((t: any) => ({
              name: t.tablename,
              size: t.size,
              columns: parseInt(t.columns, 10),
              rows: rowCounts[t.tablename],
            })),
          };
        } catch (error: any) {
          return {
            target: 'mcp',
            error: error.message,
            hint: 'MCP database not available. Run: cd novalogic-mcp && docker compose up -d',
          };
        }
      }

      return { error: `Unknown target: ${target}`, available: ['api', 'mcp'] };
    },
  },

  // ── 9. Nginx & SSL Config ──────────────────────────────────────────────
  devops_get_nginx: {
    description:
      '[DevOps Agent] Inspect Nginx and SSL/TLS configuration — reads nginx config files, certbot setup, and production proxy rules.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const apiPath = join(PROJECT_ROOT, 'api');
      const nginxConfDir = join(apiPath, 'nginx', 'conf.d');
      const dashboardNginx = join(PROJECT_ROOT, 'dashboard', 'nginx.conf');

      // Read all nginx configs
      const configs: Record<string, string | null> = {};

      // API nginx configs
      const confFiles = listDir(nginxConfDir);
      for (const f of confFiles) {
        configs[`api/nginx/conf.d/${f}`] = safeRead(join(nginxConfDir, f));
      }

      // Dashboard nginx config
      configs['dashboard/nginx.conf'] = safeRead(dashboardNginx);

      // Production compose (has nginx/certbot services)
      const prodCompose = safeRead(join(apiPath, 'docker-compose.prod.yml'));

      // Check certbot directories
      const certbotConf = existsSync(join(apiPath, 'nginx', 'certbot', 'conf'));
      const certbotWww = existsSync(join(apiPath, 'nginx', 'certbot', 'www'));

      return {
        configs,
        productionCompose: prodCompose || 'Not found',
        ssl: {
          certbotConfigDir: certbotConf ? 'exists' : 'not setup',
          certbotWebrootDir: certbotWww ? 'exists' : 'not setup',
          note: 'SSL managed by certbot container with auto-renewal (12h interval)',
        },
      };
    },
  },

  // ── 10. Record Infrastructure Decision ─────────────────────────────────
  devops_record_decision: {
    description:
      '[DevOps Agent] Record an infrastructure or DevOps decision — stores decisions about Docker config, deployment strategy, scaling, CI/CD, etc. in the architecture_decisions table.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        title: {
          type: 'string',
          description: 'Decision title (e.g., "Use pgvector for semantic search")',
        },
        context: {
          type: 'string',
          description: 'Why was this decision needed?',
        },
        decision: {
          type: 'string',
          description: 'What was decided?',
        },
        consequences: {
          type: 'string',
          description: 'What are the implications?',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags (e.g., "docker,database,production")',
        },
      },
      required: ['title', 'decision'],
    },
    handler: async (args: any) => {
      const tags = args.tags
        ? args.tags.split(',').map((t: string) => t.trim())
        : [];

      const result = await query(
        `INSERT INTO architecture_decisions (title, context, decision, consequences, status, domain, tags)
         VALUES ($1, $2, $3, $4, 'accepted', 'devops', $5)
         RETURNING id, title, created_at`,
        [args.title, args.context || null, args.decision, args.consequences || null, tags],
      );

      return {
        saved: true,
        decision: result.rows[0],
      };
    },
  },
};
