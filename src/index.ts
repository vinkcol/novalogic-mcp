#!/usr/bin/env node

/**
 * Novalogic MCP Server
 *
 * Multi-agent context management server for Claude Code.
 * Organized into 6 areas with 16 specialized agents:
 *
 * CONOCIMIENTO (Knowledge)
 *   └─ Librarian [LEAD] — Contextual memory (vector + text search)
 *
 * INGENIERÍA (Engineering)
 *   └─ Architect [LEAD] — Project structure & architectural decisions
 *   ├─ Backend [SPECIALIST] — NestJS module inspection & patterns
 *   ├─ Frontend [SPECIALIST] — React feature inspection & patterns
 *   └─ DevOps [SPECIALIST] — Docker, databases, Nginx, deployment
 *
 * NEGOCIO (Business)
 *   └─ Cassius [LEAD] — Controller, CFO, profitability & numbers
 *   ├─ Cyrus [SPECIALIST] — Strategist, marketing & market architecture
 *   ├─ Justinian [SPECIALIST] — Compliance, legal & risk mitigation
 *   └─ Octavius [SPECIALIST] — Analyst, BI & KPIs
 *
 * PRODUCTO (Product)
 *   └─ PM [LEAD] — Backlog, sprints, task management
 *   ├─ QA [SPECIALIST] — Convention checks, issue tracking, test coverage
 *   └─ UX/UI [SPECIALIST] — Design system, tokens, accessibility
 *
 * COMERCIAL (Growth)
 *   └─ Sales B2B [LEAD] — Personas, pricing, funnel, competitors
 *   └─ Content/SEO [SPECIALIST] — Page content, meta tags, SEO scoring
 *
 * OPERACIONES (Operations)
 *   └─ Logistics [LEAD] — Zones, subzones, carriers, coverage
 *   └─ Browser [SPECIALIST] — Headless browser testing & automation
 *
 * Transport: stdio (standard for Claude Code MCP servers)
 * Uses low-level Server API with raw JSON Schema — no Zod dependency.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { initDb } from './db/client.js';
import { initMongo } from './db/mongo-client.js';
import { loadAllAreas, generateAgentsGuideFromAreas } from './registry/index.js';

// ---------------------------------------------------------------------------
// Load env from .env file if present
// ---------------------------------------------------------------------------
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

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

// ---------------------------------------------------------------------------
// Create low-level MCP Server (raw JSON Schema, no Zod)
// ---------------------------------------------------------------------------
const server = new Server(
  { name: 'novalogic-mcp', version: '2.0.0' },
  { capabilities: { tools: {}, resources: {} } },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
async function main() {
  try {
    await initDb();
  } catch (error: any) {
    process.stderr.write(
      `[novalogic-mcp] Warning: Database not available (${error.message}). ` +
        'Memory, PM, and QA tools require Docker containers.\n' +
        'Run: cd novalogic-mcp && docker compose up -d\n',
    );
  }

  try {
    await initMongo();
  } catch (error: any) {
    process.stderr.write(
      `[novalogic-mcp] Warning: MongoDB not available (${error.message}). ` +
        'Business process tools require the MongoDB container.\n' +
        'Run: cd novalogic-mcp && docker compose up -d\n',
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
  // Tool handlers
  // -------------------------------------------------------------------------
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.entries(allTools).map(([name, tool]) => ({
      name,
      description: tool.description,
      inputSchema: tool.inputSchema || { type: 'object', properties: {} },
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const tool = allTools[name];

    if (!tool) {
      return {
        content: [{ type: 'text', text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
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
            text: JSON.stringify({
              error: error.message,
              tool: name,
              hint: 'Make sure the novalogic-environment Docker containers are running: docker compose up -d',
            }),
          },
        ],
        isError: true,
      };
    }
  });

  // -------------------------------------------------------------------------
  // Resource handlers
  // -------------------------------------------------------------------------
  const resourceList = [
    { name: 'project-overview', uri: 'novalogic://project/overview' },
    { name: 'agents-guide', uri: 'novalogic://agents/guide' },
  ];

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resourceList.map((r) => ({
      name: r.name,
      uri: r.uri,
      mimeType: 'text/markdown',
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
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
          text: `# Novalogic Project Context\n\n${claudeMd}\n\n## Domain Mapping\n\`\`\`json\n${domainJson}\n\`\`\``,
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

    throw new Error(`Unknown resource: ${uri}`);
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(
    `[novalogic-mcp] Server v2.0.0 started — ${areaCount} areas, ${agentCount} agents, ${toolCount} tools\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`[novalogic-mcp] Fatal error: ${error.message}\n`);
  process.exit(1);
});
