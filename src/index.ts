#!/usr/bin/env node

/**
 * Novalogic MCP Server v2.1.0
 *
 * Multi-agent context management server for Claude Code.
 * Organized into 3 layers, 11 areas, 45 agents, 461 tools.
 *
 * Transport:
 *   - stdio  (default, for Claude Code MCP bridge)
 *   - http   (NOVALOGIC_MCP_TRANSPORT=http, for Docker production)
 *
 * Uses low-level Server API with raw JSON Schema -- no Zod dependency.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initDb } from './db/client.js';
import { initMongo } from './db/mongo-client.js';
import { loadAllAreas, generateAgentsGuideFromAreas } from './registry/index.js';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

// ---------------------------------------------------------------------------
// Load env from .env file if present
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
try {
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file is optional
}

const VERSION = '2.1.0';
const TRANSPORT = process.env.NOVALOGIC_MCP_TRANSPORT || 'stdio';
const PORT = parseInt(process.env.NOVALOGIC_MCP_PORT || '8100', 10);

// ---------------------------------------------------------------------------
// Create low-level MCP Server (raw JSON Schema, no Zod)
// ---------------------------------------------------------------------------
function createServer(): Server {
  return new Server(
    { name: 'novalogic-mcp', version: VERSION },
    { capabilities: { tools: {}, resources: {} } },
  );
}

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
  try {
    await initDb();
  } catch (error: any) {
    process.stderr.write(
      '[novalogic-mcp] Warning: Database not available (' + error.message + '). ' +
        'Memory, PM, and QA tools require Docker containers.\n',
    );
  }

  try {
    await initMongo();
  } catch (error: any) {
    process.stderr.write(
      '[novalogic-mcp] Warning: MongoDB not available (' + error.message + '). ' +
        'Business process tools require the MongoDB container.\n',
    );
  }

  // Load all areas and tools via auto-discovery
  const { areas, allTools } = await loadAllAreas();

  const toolCount = Object.keys(allTools).length;
  const areaCount = Object.keys(areas).length;
  const agentCount = Object.values(areas).reduce(
    (sum, area) => sum + Object.keys(area.agents).length,
    0,
  );

  // -------------------------------------------------------------------------
  // Register handlers on a server instance
  // -------------------------------------------------------------------------
  function registerHandlers(srv: Server): void {
    srv.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: Object.entries(allTools).map(([name, tool]) => ({
        name,
        description: tool.description,
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
      })),
    }));

    srv.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      const tool = allTools[name];

      if (!tool) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'Unknown tool: ' + name }) }],
          isError: true,
        };
      }

      try {
        const result = await tool.handler(args || {});
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (error: any) {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ error: error.message, tool: name }),
            },
          ],
          isError: true,
        };
      }
    });

    const resourceList = [
      { name: 'project-overview', uri: 'novalogic://project/overview' },
      { name: 'agents-guide', uri: 'novalogic://agents/guide' },
    ];

    srv.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: resourceList.map((r) => ({
        name: r.name,
        uri: r.uri,
        mimeType: 'text/markdown',
      })),
    }));

    srv.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'novalogic://project/overview') {
        const projectRoot = process.env.NOVALOGIC_PROJECT_ROOT || '';
        let claudeMd = '';
        let domainJson = '';
        try { claudeMd = readFileSync(join(projectRoot, 'CLAUDE.md'), 'utf-8'); } catch {}
        try { domainJson = readFileSync(join(projectRoot, 'novalogic_domain.json'), 'utf-8'); } catch {}

        return {
          contents: [{
            uri,
            mimeType: 'text/markdown',
            text: '# Novalogic Project Context\n\n' + claudeMd + '\n\n## Domain Mapping\n```json\n' + domainJson + '\n```',
          }],
        };
      }

      if (uri === 'novalogic://agents/guide') {
        return {
          contents: [{
            uri,
            mimeType: 'text/markdown',
            text: generateAgentsGuideFromAreas(areas),
          }],
        };
      }

      throw new Error('Unknown resource: ' + uri);
    });
  }

  // -------------------------------------------------------------------------
  // Transport selection
  // -------------------------------------------------------------------------
  if (TRANSPORT === 'http') {
    const { default: express } = await import('express');
    const app = express();
    app.use(express.json());

    const sessions = new Map<string, { server: Server; transport: StreamableHTTPServerTransport }>();

    // Health check
    app.get('/health', (_req, res) => {
      res.json({
        status: 'ok',
        version: VERSION,
        transport: 'http',
        areas: areaCount,
        agents: agentCount,
        tools: toolCount,
        uptime: process.uptime(),
      });
    });

    // MCP Streamable HTTP — POST (initialize + tool calls)
    app.post('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;

      if (sessionId && sessions.has(sessionId)) {
        const session = sessions.get(sessionId)!;
        await session.transport.handleRequest(req, res, req.body);
        return;
      }

      const newSessionId = randomUUID();
      const srv = createServer();
      registerHandlers(srv);

      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => newSessionId,
        onsessioninitialized: (id) => {
          sessions.set(id, { server: srv, transport });
        },
      });

      transport.onclose = () => {
        sessions.delete(newSessionId);
      };

      await srv.connect(transport);
      await transport.handleRequest(req, res, req.body);
    });

    // MCP Streamable HTTP — GET (SSE stream for server notifications)
    app.get('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: 'Invalid or missing session ID' });
        return;
      }
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
    });

    // MCP Streamable HTTP — DELETE (close session)
    app.delete('/mcp', async (req, res) => {
      const sessionId = req.headers['mcp-session-id'] as string | undefined;
      if (!sessionId || !sessions.has(sessionId)) {
        res.status(400).json({ error: 'Invalid or missing session ID' });
        return;
      }
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res);
      sessions.delete(sessionId);
    });

    app.listen(PORT, '0.0.0.0', () => {
      process.stderr.write(
        '[novalogic-mcp] Server v' + VERSION + ' started (HTTP) — ' +
        areaCount + ' areas, ' + agentCount + ' agents, ' + toolCount + ' tools — ' +
        'listening on 0.0.0.0:' + PORT + '\n',
      );
    });
  } else {
    // Development: stdio transport (Claude Code bridge)
    const srv = createServer();
    registerHandlers(srv);
    const transport = new StdioServerTransport();
    await srv.connect(transport);
    process.stderr.write(
      '[novalogic-mcp] Server v' + VERSION + ' started (stdio) — ' +
      areaCount + ' areas, ' + agentCount + ' agents, ' + toolCount + ' tools\n',
    );
  }
}

main().catch((error) => {
  process.stderr.write('[novalogic-mcp] Fatal error: ' + error.message + '\n');
  process.exit(1);
});
