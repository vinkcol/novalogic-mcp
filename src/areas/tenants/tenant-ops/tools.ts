import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join as pathJoin, relative as pathRelative } from 'path';
import { spawnSync } from 'child_process';
import ExcelJS from 'exceljs';
import type { ToolDefinition } from '../../../shared/types.js';
import {
  DEFAULT_SCOPES,
  PUBLIC_CLIENT_ID,
  getValidAccessToken,
  pollDeviceFlow,
  readPending,
  readTokens,
  refreshTokens,
  startDeviceFlow,
} from '../../../services/ms-graph-auth.js';
import { query } from '../../../db/client.js';
import {
  STORAGE_ROOT,
  assertName,
  assertSlug,
  ensureTenantDirs,
  listFiles,
  listFilesRecursive,
  listTenants,
  readJson,
  readText,
  tenantPath,
  writeJson,
  writeText,
} from '../../../services/tenant-storage.js';

const tenantProp = {
  type: 'string',
  description: 'Company slug (lowercase, e.g. "simora")',
};

export const tools: Record<string, ToolDefinition> = {
  // ────────────────────────── TENANT ──────────────────────────
  tenant_list: {
    description:
      '[Tenant Ops] List companies that have a storage/<slug>/ directory with tenant-specific logic.',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => ({
      storage_root: STORAGE_ROOT,
      tenants: listTenants(),
    }),
  },

  tenant_init: {
    description:
      '[Tenant Ops] Initialize storage/<slug>/ with the standard folders (flows, mappings, datasets, rules, reports) and an empty context.md.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        context: {
          type: 'string',
          description: 'Optional initial context.md content',
        },
      },
      required: ['slug'],
    },
    handler: async ({ slug, context }: { slug: string; context?: string }) => {
      ensureTenantDirs(slug);
      const ctxPath = tenantPath(slug, 'context.md');
      if (!existsSync(ctxPath)) {
        writeText(ctxPath, context || `# ${slug}\n\n(briefing pendiente)\n`);
      }
      return { ok: true, slug, path: tenantPath(slug) };
    },
  },

  tenant_context_get: {
    description:
      '[Tenant Ops] Read context.md — briefing del negocio del tenant (prompt/guía para el agente).',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => {
      const p = tenantPath(slug, 'context.md');
      if (!existsSync(p)) return { slug, context: null };
      return { slug, context: readText(p) };
    },
  },

  tenant_context_save: {
    description: '[Tenant Ops] Overwrite context.md for a tenant.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        context: { type: 'string' },
      },
      required: ['slug', 'context'],
    },
    handler: async ({ slug, context }: { slug: string; context: string }) => {
      writeText(tenantPath(slug, 'context.md'), context);
      return { ok: true };
    },
  },

  // ────────────────────────── FLOWS ──────────────────────────
  tenant_flow_list: {
    description:
      '[Tenant Ops] List available flows for a tenant (storage/<slug>/flows/*.json).',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => {
      const dir = tenantPath(slug, 'flows');
      const files = listFiles(dir, ['.json']);
      const flows = files.map((f) => {
        const def = readJson(tenantPath(slug, 'flows', f));
        return {
          name: f.replace(/\.json$/, ''),
          description: def.description,
          steps: Array.isArray(def.steps) ? def.steps.length : 0,
        };
      });
      return { slug, flows };
    },
  },

  tenant_flow_get: {
    description:
      '[Tenant Ops] Return the full JSON definition of a flow — agent should then execute each step by calling the referenced tools.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        name: { type: 'string', description: 'Flow name (without .json)' },
      },
      required: ['slug', 'name'],
    },
    handler: async ({ slug, name }: { slug: string; name: string }) => {
      assertName(name, 'flow name');
      const p = tenantPath(slug, 'flows', `${name}.json`);
      if (!existsSync(p)) throw new Error(`Flow not found: ${name}`);
      return { slug, name, definition: readJson(p) };
    },
  },

  tenant_flow_save: {
    description:
      '[Tenant Ops] Save (create or overwrite) a flow definition. Definition must be an object with { description, trigger?, steps:[{tool,args,saveAs?}] }.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        name: { type: 'string' },
        definition: { type: 'object' },
      },
      required: ['slug', 'name', 'definition'],
    },
    handler: async ({
      slug,
      name,
      definition,
    }: {
      slug: string;
      name: string;
      definition: Record<string, unknown>;
    }) => {
      assertName(name, 'flow name');
      ensureTenantDirs(slug);
      writeJson(tenantPath(slug, 'flows', `${name}.json`), definition);
      return { ok: true, path: `storage/${slug}/flows/${name}.json` };
    },
  },

  tenant_flow_delete: {
    description: '[Tenant Ops] Delete a flow.',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp, name: { type: 'string' } },
      required: ['slug', 'name'],
    },
    handler: async ({ slug, name }: { slug: string; name: string }) => {
      assertName(name, 'flow name');
      const p = tenantPath(slug, 'flows', `${name}.json`);
      if (existsSync(p)) unlinkSync(p);
      return { ok: true };
    },
  },

  // ────────────────────────── MAPPINGS ──────────────────────────
  tenant_mapping_list: {
    description:
      '[Tenant Ops] List mappings (key→value dictionaries) for a tenant.',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => ({
      slug,
      mappings: listFiles(tenantPath(slug, 'mappings'), ['.json']).map((f) =>
        f.replace(/\.json$/, ''),
      ),
    }),
  },

  tenant_mapping_get: {
    description:
      '[Tenant Ops] Return the full mapping object (e.g. chart-of-accounts, sku-aliases).',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp, name: { type: 'string' } },
      required: ['slug', 'name'],
    },
    handler: async ({ slug, name }: { slug: string; name: string }) => {
      assertName(name, 'mapping name');
      const p = tenantPath(slug, 'mappings', `${name}.json`);
      if (!existsSync(p)) throw new Error(`Mapping not found: ${name}`);
      return { slug, name, data: readJson(p) };
    },
  },

  tenant_mapping_upsert: {
    description:
      '[Tenant Ops] Create or merge entries into a mapping. If replace=true overwrites the whole mapping, otherwise merges entries.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        name: { type: 'string' },
        entries: {
          type: 'object',
          description: 'Key→value pairs to merge or replace',
        },
        replace: { type: 'boolean', description: 'Default false' },
      },
      required: ['slug', 'name', 'entries'],
    },
    handler: async ({
      slug,
      name,
      entries,
      replace,
    }: {
      slug: string;
      name: string;
      entries: Record<string, unknown>;
      replace?: boolean;
    }) => {
      assertName(name, 'mapping name');
      ensureTenantDirs(slug);
      const p = tenantPath(slug, 'mappings', `${name}.json`);
      const current =
        !replace && existsSync(p)
          ? (readJson<Record<string, unknown>>(p) as Record<string, unknown>)
          : {};
      const next = { ...current, ...entries };
      writeJson(p, next);
      return { ok: true, total_keys: Object.keys(next).length };
    },
  },

  tenant_mapping_lookup: {
    description:
      '[Tenant Ops] Look up a single key in a mapping. Returns { found, value } — useful inside flows.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        name: { type: 'string' },
        key: { type: 'string' },
      },
      required: ['slug', 'name', 'key'],
    },
    handler: async ({
      slug,
      name,
      key,
    }: {
      slug: string;
      name: string;
      key: string;
    }) => {
      assertName(name, 'mapping name');
      const p = tenantPath(slug, 'mappings', `${name}.json`);
      if (!existsSync(p)) return { found: false, value: null };
      const data = readJson<Record<string, unknown>>(p);
      return { found: key in data, value: data[key] ?? null };
    },
  },

  // ────────────────────────── DATASETS ──────────────────────────
  tenant_dataset_list: {
    description:
      '[Tenant Ops] List raw files uploaded by the tenant to be crossed against Novalogic data (CSV, JSON, XLSX).',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => ({
      slug,
      datasets: listFiles(tenantPath(slug, 'datasets')),
    }),
  },

  tenant_dataset_read: {
    description:
      '[Tenant Ops] Read the first N lines of a dataset (to preview structure before processing).',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        file: { type: 'string' },
        lines: { type: 'number', description: 'Default 50, max 500' },
      },
      required: ['slug', 'file'],
    },
    handler: async ({
      slug,
      file,
      lines,
    }: {
      slug: string;
      file: string;
      lines?: number;
    }) => {
      assertSlug(slug);
      if (file.includes('..') || file.includes('/') || file.includes('\\')) {
        throw new Error('Invalid file name');
      }
      const p = tenantPath(slug, 'datasets', file);
      if (!existsSync(p)) throw new Error(`Dataset not found: ${file}`);
      const cap = Math.min(Math.max(lines || 50, 1), 500);
      const content = readText(p).split('\n').slice(0, cap).join('\n');
      return { slug, file, preview: content, lines: cap };
    },
  },

  tenant_dataset_read_excel: {
    description:
      '[Tenant Ops] Parse an XLSX/XLS file into structured JSON. Returns sheets with headers (row 1) and rows. Use sheet to pick one; omit for all.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        file: { type: 'string', description: 'e.g. "2026-04-liquidacion.xlsx"' },
        sheet: {
          type: 'string',
          description: 'Optional sheet name; if omitted, returns all sheets',
        },
        maxRows: {
          type: 'number',
          description: 'Max data rows per sheet (default 500, max 5000)',
        },
        headerRow: {
          type: 'number',
          description: 'Row number with headers (1-based, default 1)',
        },
      },
      required: ['slug', 'file'],
    },
    handler: async ({
      slug,
      file,
      sheet,
      maxRows,
      headerRow,
    }: {
      slug: string;
      file: string;
      sheet?: string;
      maxRows?: number;
      headerRow?: number;
    }) => {
      assertSlug(slug);
      if (file.includes('..') || file.includes('/') || file.includes('\\')) {
        throw new Error('Invalid file name');
      }
      const p = tenantPath(slug, 'datasets', file);
      if (!existsSync(p)) throw new Error(`Dataset not found: ${file}`);

      const cap = Math.min(Math.max(maxRows || 500, 1), 5000);
      const hdrRow = Math.max(headerRow || 1, 1);

      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(p);

      const parseSheet = (ws: ExcelJS.Worksheet) => {
        const headerRowObj = ws.getRow(hdrRow);
        const headers: string[] = [];
        headerRowObj.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          headers[colNumber - 1] = String(cell.value ?? `col_${colNumber}`);
        });

        const rows: Record<string, unknown>[] = [];
        const lastRow = Math.min(ws.rowCount, hdrRow + cap);
        for (let r = hdrRow + 1; r <= lastRow; r++) {
          const row = ws.getRow(r);
          if (!row.hasValues) continue;
          const obj: Record<string, unknown> = {};
          row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
            const key = headers[colNumber - 1] || `col_${colNumber}`;
            const v: any = cell.value;
            if (v && typeof v === 'object' && 'richText' in v) {
              obj[key] = (v.richText as any[]).map((t) => t.text).join('');
            } else if (v && typeof v === 'object' && 'result' in v) {
              obj[key] = (v as any).result;
            } else if (v && typeof v === 'object' && 'text' in v && 'hyperlink' in v) {
              obj[key] = (v as any).text;
            } else if (v instanceof Date) {
              obj[key] = v.toISOString();
            } else {
              obj[key] = v;
            }
          });
          rows.push(obj);
        }

        return {
          name: ws.name,
          headers,
          row_count: rows.length,
          total_rows_in_sheet: ws.rowCount,
          truncated: ws.rowCount > hdrRow + cap,
          rows,
        };
      };

      if (sheet) {
        const ws = wb.getWorksheet(sheet);
        if (!ws) {
          const available = wb.worksheets.map((s) => s.name);
          throw new Error(
            `Sheet "${sheet}" not found. Available: ${available.join(', ')}`,
          );
        }
        return { slug, file, sheet: parseSheet(ws) };
      }

      return {
        slug,
        file,
        sheets: wb.worksheets.map(parseSheet),
      };
    },
  },

  // ────────────────────────── RULES ──────────────────────────
  tenant_rules_get: {
    description:
      '[Tenant Ops] Read a business rules JSON file (e.g. shipping-rules, accounting-rules).',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp, name: { type: 'string' } },
      required: ['slug', 'name'],
    },
    handler: async ({ slug, name }: { slug: string; name: string }) => {
      assertName(name, 'rules name');
      const p = tenantPath(slug, 'rules', `${name}.json`);
      if (!existsSync(p)) throw new Error(`Rules not found: ${name}`);
      return { slug, name, rules: readJson(p) };
    },
  },

  tenant_rules_save: {
    description: '[Tenant Ops] Save business rules JSON file.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        name: { type: 'string' },
        rules: { type: 'object' },
      },
      required: ['slug', 'name', 'rules'],
    },
    handler: async ({
      slug,
      name,
      rules,
    }: {
      slug: string;
      name: string;
      rules: Record<string, unknown>;
    }) => {
      assertName(name, 'rules name');
      ensureTenantDirs(slug);
      writeJson(tenantPath(slug, 'rules', `${name}.json`), rules);
      return { ok: true };
    },
  },

  // ────────────────────────── INTEGRATIONS ──────────────────────────
  tenant_integration_list: {
    description:
      '[Tenant Ops] List third-party integrations registered for a tenant (storage/<slug>/integrations/*.json). Does NOT include secrets.',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => {
      const dir = tenantPath(slug, 'integrations');
      const files = listFiles(dir, ['.json']);
      const integrations = files.map((f) => {
        const data = readJson<Record<string, any>>(tenantPath(slug, 'integrations', f));
        return {
          name: f.replace(/\.json$/, ''),
          provider: data.provider,
          status: data.status,
          account: data.account,
          updated_at: data._meta?.updated_at,
        };
      });
      return { slug, integrations };
    },
  },

  tenant_integration_get: {
    description:
      '[Tenant Ops] Return the full integration metadata JSON (e.g. Microsoft, Google). Secrets (client_secret, tokens) must NEVER live here — only references to API connection IDs stored in Novalogic DB.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        name: { type: 'string', description: 'e.g. "microsoft"' },
      },
      required: ['slug', 'name'],
    },
    handler: async ({ slug, name }: { slug: string; name: string }) => {
      assertName(name, 'integration name');
      const p = tenantPath(slug, 'integrations', `${name}.json`);
      if (!existsSync(p)) throw new Error(`Integration not found: ${name}`);
      return { slug, name, data: readJson(p) };
    },
  },

  tenant_integration_save: {
    description:
      '[Tenant Ops] Save (create or overwrite) integration metadata. Store references and config — NEVER tokens or secrets (those live encrypted in Novalogic DB `oauth_connections`).',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        name: { type: 'string' },
        data: { type: 'object' },
      },
      required: ['slug', 'name', 'data'],
    },
    handler: async ({
      slug,
      name,
      data,
    }: {
      slug: string;
      name: string;
      data: Record<string, unknown>;
    }) => {
      assertName(name, 'integration name');
      ensureTenantDirs(slug);
      const p = tenantPath(slug, 'integrations', `${name}.json`);
      const body = {
        _meta: {
          description: (data as any)?._meta?.description || `${name} integration metadata`,
          updated_at: new Date().toISOString().slice(0, 10),
          ...(data as any)?._meta,
        },
        ...data,
      };
      writeJson(p, body);
      return { ok: true, path: `storage/${slug}/integrations/${name}.json` };
    },
  },

  tenant_ms_auth_start: {
    description:
      '[Tenant Ops] Start Microsoft device code flow for a tenant. Returns a URL + user code — open the URL in a browser and enter the code to sign in. Uses the public "Microsoft Graph Command Line Tools" client (no Azure app registration needed).',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        scopes: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional OAuth scopes. Defaults to offline_access User.Read Files.ReadWrite.All Sites.ReadWrite.All',
        },
      },
      required: ['slug'],
    },
    handler: async ({
      slug,
      scopes,
    }: {
      slug: string;
      scopes?: string[];
    }) => {
      const pending = await startDeviceFlow(slug, scopes);
      return {
        slug,
        verification_uri: pending.verification_uri,
        user_code: pending.user_code,
        expires_at: new Date(pending.expires_at).toISOString(),
        interval_seconds: pending.interval,
        scopes: pending.scopes,
        instructions:
          `Open ${pending.verification_uri} in a browser, sign in with the business account, ` +
          `and enter the code: ${pending.user_code}. Then call tenant_ms_auth_poll with slug="${slug}".`,
      };
    },
  },

  tenant_ms_auth_poll: {
    description:
      '[Tenant Ops] Poll Microsoft for the result of the device code flow started with tenant_ms_auth_start. Returns { status: "pending" | "completed" | "expired" | "error" }. On completed, tokens are stored encrypted and metadata saved to storage/<slug>/integrations/microsoft.json.',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => {
      const result = await pollDeviceFlow(slug);
      if (result.status === 'completed') {
        ensureTenantDirs(slug);
        const metadata = {
          _meta: {
            description: 'Microsoft Graph connection metadata (no secrets)',
            updated_at: new Date().toISOString().slice(0, 10),
          },
          provider: 'microsoft',
          status: 'active',
          client_id: PUBLIC_CLIENT_ID,
          client_type: 'public_device_code',
          account: {
            id: result.user.id,
            email: result.user.mail || result.user.userPrincipalName,
            display_name: result.user.displayName,
            tenant_id: result.tokens.tenant_id,
            job_title: result.user.jobTitle,
          },
          scopes: result.tokens.scopes,
          connected_at: new Date(result.tokens.obtained_at).toISOString(),
          token_storage: {
            location: `storage/${slug}/integrations/.microsoft.tokens.enc`,
            encryption: 'AES-256-GCM',
            note: 'Tokens encrypted at rest with MCP_TOKEN_ENCRYPTION_KEY (or ephemeral key in dev)',
          },
        };
        writeJson(
          tenantPath(slug, 'integrations', 'microsoft.json'),
          metadata,
        );
        return { status: 'completed', metadata };
      }
      return result;
    },
  },

  tenant_ms_auth_status: {
    description:
      '[Tenant Ops] Check status of Microsoft connection for a tenant — returns pending flow info (if any) and whether tokens exist.',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => {
      const pending = readPending(slug);
      const tokens = readTokens(slug);
      return {
        slug,
        has_pending_flow: !!pending && Date.now() < (pending?.expires_at ?? 0),
        pending_expires_at: pending
          ? new Date(pending.expires_at).toISOString()
          : null,
        has_tokens: !!tokens,
        token_expires_at: tokens
          ? new Date(tokens.expires_at).toISOString()
          : null,
        scopes: tokens?.scopes,
        tenant_id: tokens?.tenant_id,
      };
    },
  },

  tenant_ms_auth_refresh: {
    description:
      '[Tenant Ops] Force refresh of the Microsoft access token for a tenant using the stored refresh_token.',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => {
      const tokens = await refreshTokens(slug);
      return {
        slug,
        refreshed: true,
        expires_at: new Date(tokens.expires_at).toISOString(),
        scopes: tokens.scopes,
      };
    },
  },

  tenant_ms_graph_request: {
    description:
      '[Tenant Ops] Execute an authenticated Microsoft Graph request using the tenant\'s stored credentials. Path is relative to https://graph.microsoft.com/v1.0. Returns JSON response.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        method: {
          type: 'string',
          enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
          description: 'Default GET',
        },
        path: {
          type: 'string',
          description: 'e.g. "/me/drive/root/children"',
        },
        body: {
          type: 'object',
          description: 'Optional JSON body',
        },
      },
      required: ['slug', 'path'],
    },
    handler: async ({
      slug,
      method,
      path,
      body,
    }: {
      slug: string;
      method?: string;
      path: string;
      body?: unknown;
    }) => {
      const token = await getValidAccessToken(slug);
      const url = path.startsWith('http')
        ? path
        : `https://graph.microsoft.com/v1.0${path}`;
      const response = await fetch(url, {
        method: method || 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let data: unknown = text;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        // keep as text
      }
      return {
        slug,
        status: response.status,
        ok: response.ok,
        data,
      };
    },
  },

  tenant_ms_onedrive_snapshot: {
    description:
      '[Tenant Ops] Walk OneDrive recursively and upsert every folder/file as nodes into a graph (type=tree). Uses parent_key for hierarchy. Returns counts.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        graph: {
          type: 'string',
          description: 'Target graph name (must already exist)',
        },
        root_item_id: {
          type: 'string',
          description:
            'Start from this folder id (defaults to drive root). Use to snapshot a single subtree.',
        },
        max_depth: {
          type: 'number',
          description: 'Default 3, max 20',
        },
        include_files: {
          type: 'boolean',
          description: 'Default true. If false, only folders are imported.',
        },
        clear_first: {
          type: 'boolean',
          description: 'If true, delete existing nodes in the graph first.',
        },
      },
      required: ['slug', 'graph'],
    },
    handler: async ({
      slug,
      graph,
      root_item_id,
      max_depth,
      include_files,
      clear_first,
    }: {
      slug: string;
      graph: string;
      root_item_id?: string;
      max_depth?: number;
      include_files?: boolean;
      clear_first?: boolean;
    }) => {
      const depthCap = Math.min(Math.max(max_depth || 3, 1), 20);
      const wantFiles = include_files !== false;

      const graphRow = await query<{ id: number }>(
        'SELECT id FROM graphs WHERE name = $1',
        [graph],
      );
      if (!graphRow.rows.length) {
        throw new Error(`Graph not found: ${graph}`);
      }
      const graphId = graphRow.rows[0].id;

      if (clear_first) {
        await query('DELETE FROM graph_nodes WHERE graph_id = $1', [graphId]);
      }

      const token = await getValidAccessToken(slug);
      const rootPath = root_item_id
        ? `/me/drive/items/${root_item_id}`
        : `/me/drive/root`;

      async function graphGet(path: string, absolute = false): Promise<any> {
        const url = absolute
          ? path
          : `https://graph.microsoft.com/v1.0${path}`;
        const r = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!r.ok) throw new Error(`Graph ${r.status}: ${await r.text()}`);
        return r.json();
      }

      const rootItem: any = await graphGet(rootPath);
      const rootKey = rootItem.id as string;

      await query(
        `INSERT INTO graph_nodes (graph_id, key, name, type, properties, parent_key)
         VALUES ($1, $2, $3, 'folder', $4, NULL)
         ON CONFLICT (graph_id, key) DO UPDATE SET
           name = EXCLUDED.name, type = EXCLUDED.type,
           properties = EXCLUDED.properties, updated_at = NOW()`,
        [
          graphId,
          rootKey,
          rootItem.name || 'root',
          {
            size: rootItem.size,
            web_url: rootItem.webUrl,
            drive_id: rootItem.parentReference?.driveId,
            is_root: true,
          },
        ],
      );

      let folderCount = 1;
      let fileCount = 0;
      const queue: Array<{ id: string; depth: number }> = [
        { id: rootKey, depth: 0 },
      ];

      while (queue.length) {
        const current = queue.shift()!;
        if (current.depth >= depthCap) continue;

        let nextUrl: string | undefined = `/me/drive/items/${current.id}/children?$select=id,name,folder,file,size,lastModifiedDateTime,parentReference,webUrl&$top=200`;
        let absolute = false;

        while (nextUrl) {
          const page: any = await graphGet(nextUrl, absolute);
          for (const item of page.value as any[]) {
            const isFolder = !!item.folder;
            if (!isFolder && !wantFiles) continue;
            const props = {
              size: item.size,
              last_modified: item.lastModifiedDateTime,
              web_url: item.webUrl,
              drive_id: item.parentReference?.driveId,
              mime_type: item.file?.mimeType,
              child_count: item.folder?.childCount,
            };
            await query(
              `INSERT INTO graph_nodes (graph_id, key, name, type, properties, parent_key)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (graph_id, key) DO UPDATE SET
                 name = EXCLUDED.name, type = EXCLUDED.type,
                 properties = EXCLUDED.properties,
                 parent_key = EXCLUDED.parent_key, updated_at = NOW()`,
              [
                graphId,
                item.id,
                item.name,
                isFolder ? 'folder' : 'file',
                props,
                current.id,
              ],
            );
            if (isFolder) {
              folderCount++;
              queue.push({ id: item.id, depth: current.depth + 1 });
            } else {
              fileCount++;
            }
          }
          nextUrl = page['@odata.nextLink'];
          absolute = true;
        }
      }

      return {
        slug,
        graph,
        root_key: rootKey,
        folders_imported: folderCount,
        files_imported: fileCount,
        max_depth: depthCap,
      };
    },
  },

  tenant_audit_classify: {
    description:
      '[Tenant Ops] Classify every node in a folder-tree graph by extension + name heuristics. Writes a "category" property to each node (e.g. spreadsheet, document, image, pdf, video, archive, code, data, other). Non-destructive for other properties.',
    inputSchema: {
      type: 'object',
      properties: { graph: { type: 'string' } },
      required: ['graph'],
    },
    handler: async ({ graph }: { graph: string }) => {
      const g = await query<{ id: number }>(
        'SELECT id FROM graphs WHERE name = $1',
        [graph],
      );
      if (!g.rows.length) throw new Error(`Graph not found: ${graph}`);
      const graphId = g.rows[0].id;

      const rules: Array<{ pattern: RegExp; category: string }> = [
        { pattern: /\.(xlsx?|ods|csv)$/i, category: 'spreadsheet' },
        { pattern: /\.(docx?|odt|rtf|pages)$/i, category: 'document' },
        { pattern: /\.(pptx?|odp|key)$/i, category: 'presentation' },
        { pattern: /\.pdf$/i, category: 'pdf' },
        { pattern: /\.(png|jpe?g|gif|webp|bmp|tiff?|heic|svg)$/i, category: 'image' },
        { pattern: /\.(mp4|mov|avi|mkv|webm|wmv)$/i, category: 'video' },
        { pattern: /\.(mp3|wav|flac|m4a|aac|ogg)$/i, category: 'audio' },
        { pattern: /\.(zip|rar|7z|tar|gz|bz2)$/i, category: 'archive' },
        { pattern: /\.(json|xml|yaml|ya?ml)$/i, category: 'data' },
        { pattern: /\.(txt|md|log)$/i, category: 'text' },
        { pattern: /\.(js|ts|py|java|go|rs|c|cpp|html?|css|sql|sh|ps1)$/i, category: 'code' },
        { pattern: /\.(msg|eml)$/i, category: 'email' },
        { pattern: /\.(whiteboard|fluid|loop)$/i, category: 'collaboration' },
      ];

      const nodes = await query<{ id: number; name: string | null; type: string | null; properties: any }>(
        'SELECT id, name, type, properties FROM graph_nodes WHERE graph_id = $1',
        [graphId],
      );

      let classified = 0;
      const counts: Record<string, number> = {};
      for (const node of nodes.rows) {
        let category = 'other';
        if (node.type === 'folder') category = 'folder';
        else if (node.name) {
          for (const rule of rules) {
            if (rule.pattern.test(node.name)) {
              category = rule.category;
              break;
            }
          }
        }
        const props = { ...(node.properties || {}), category };
        await query('UPDATE graph_nodes SET properties = $1 WHERE id = $2', [
          props,
          node.id,
        ]);
        counts[category] = (counts[category] || 0) + 1;
        classified++;
      }

      return { graph, classified, breakdown: counts };
    },
  },

  tenant_audit_summary: {
    description:
      '[Tenant Ops] Aggregate stats for a folder-tree graph: total size, counts by category, by top-level area, by year (from last_modified).',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string' },
        root_key: {
          type: 'string',
          description: 'Optional root to scope the summary to a subtree',
        },
      },
      required: ['graph'],
    },
    handler: async ({ graph, root_key }: { graph: string; root_key?: string }) => {
      const g = await query<{ id: number }>(
        'SELECT id FROM graphs WHERE name = $1',
        [graph],
      );
      if (!g.rows.length) throw new Error(`Graph not found: ${graph}`);
      const graphId = g.rows[0].id;

      const where = root_key
        ? `graph_id = $1 AND key IN (
             WITH RECURSIVE tree AS (
               SELECT key FROM graph_nodes WHERE graph_id = $1 AND key = $2
               UNION ALL
               SELECT n.key FROM graph_nodes n
                 JOIN tree t ON n.parent_key = t.key AND n.graph_id = $1
             ) SELECT key FROM tree
           )`
        : 'graph_id = $1';
      const params: any[] = root_key ? [graphId, root_key] : [graphId];

      const totals = await query(
        `SELECT
           COUNT(*) FILTER (WHERE type = 'file') AS file_count,
           COUNT(*) FILTER (WHERE type = 'folder') AS folder_count,
           COALESCE(SUM((properties->>'size')::bigint) FILTER (WHERE type = 'file'), 0) AS total_bytes
         FROM graph_nodes WHERE ${where}`,
        params,
      );

      const byCategory = await query(
        `SELECT properties->>'category' AS category,
                COUNT(*) AS count,
                COALESCE(SUM((properties->>'size')::bigint), 0) AS bytes
         FROM graph_nodes
         WHERE ${where} AND type = 'file'
         GROUP BY properties->>'category'
         ORDER BY bytes DESC`,
        params,
      );

      const byYear = await query(
        `SELECT SUBSTRING(properties->>'last_modified' FROM 1 FOR 4) AS year,
                COUNT(*) AS count,
                COALESCE(SUM((properties->>'size')::bigint), 0) AS bytes
         FROM graph_nodes
         WHERE ${where} AND type = 'file' AND properties->>'last_modified' IS NOT NULL
         GROUP BY year
         ORDER BY year DESC`,
        params,
      );

      let effectiveRoot = root_key;
      if (!effectiveRoot) {
        const rootRow = await query<{ key: string }>(
          `SELECT key FROM graph_nodes WHERE graph_id = $1 AND parent_key IS NULL LIMIT 1`,
          [graphId],
        );
        effectiveRoot = rootRow.rows[0]?.key;
      }

      const topLevel = effectiveRoot
        ? await query(
            `WITH RECURSIVE descendants AS (
               SELECT key, parent_key, type, (properties->>'size')::bigint AS size
                 FROM graph_nodes WHERE graph_id = $1 AND parent_key = $2
               UNION ALL
               SELECT c.key, c.parent_key, c.type, (c.properties->>'size')::bigint
                 FROM graph_nodes c JOIN descendants d ON c.parent_key = d.key
                 WHERE c.graph_id = $1
             )
             SELECT n.key, n.name,
                    COALESCE(SUM(CASE WHEN d.type = 'file' THEN 1 ELSE 0 END), 0) AS descendant_files,
                    COALESCE(SUM(CASE WHEN d.type = 'file' THEN d.size ELSE 0 END), 0) AS descendant_bytes
             FROM graph_nodes n
             LEFT JOIN LATERAL (
               WITH RECURSIVE sub AS (
                 SELECT key, type, (properties->>'size')::bigint AS size
                   FROM graph_nodes WHERE graph_id = $1 AND parent_key = n.key
                 UNION ALL
                 SELECT c.key, c.type, (c.properties->>'size')::bigint
                   FROM graph_nodes c JOIN sub ON c.parent_key = sub.key
                   WHERE c.graph_id = $1
               ) SELECT * FROM sub
             ) d ON true
             WHERE n.graph_id = $1 AND n.parent_key = $2
             GROUP BY n.key, n.name
             ORDER BY descendant_bytes DESC`,
            [graphId, effectiveRoot],
          )
        : { rows: [] };

      return {
        graph,
        root_key: root_key || null,
        totals: totals.rows[0],
        by_category: byCategory.rows,
        by_year: byYear.rows,
        top_level_areas: topLevel.rows,
      };
    },
  },

  tenant_audit_duplicates: {
    description:
      '[Tenant Ops] Find likely duplicate files in a graph by grouping on (size, name) — a cheap heuristic that does not require downloading content. For exact byte-match use tenant_ms_enrich_graph_hashes (not yet implemented).',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string' },
        min_size: {
          type: 'number',
          description: 'Ignore files smaller than this many bytes (default 1024)',
        },
      },
      required: ['graph'],
    },
    handler: async ({ graph, min_size }: { graph: string; min_size?: number }) => {
      const g = await query<{ id: number }>(
        'SELECT id FROM graphs WHERE name = $1',
        [graph],
      );
      if (!g.rows.length) throw new Error(`Graph not found: ${graph}`);
      const minBytes = min_size || 1024;

      const dups = await query(
        `SELECT name, (properties->>'size')::bigint AS size,
                COUNT(*) AS copies,
                json_agg(json_build_object(
                  'key', key,
                  'parent_key', parent_key,
                  'last_modified', properties->>'last_modified',
                  'web_url', properties->>'web_url'
                )) AS instances
         FROM graph_nodes
         WHERE graph_id = $1 AND type = 'file'
           AND (properties->>'size')::bigint >= $2
         GROUP BY name, (properties->>'size')::bigint
         HAVING COUNT(*) > 1
         ORDER BY COUNT(*) DESC, size DESC
         LIMIT 500`,
        [g.rows[0].id, minBytes],
      );

      const totalWaste = dups.rows.reduce(
        (acc, r: any) => acc + Number(r.size) * (Number(r.copies) - 1),
        0,
      );

      return {
        graph,
        duplicate_groups: dups.rows.length,
        estimated_wasted_bytes: totalWaste,
        groups: dups.rows,
      };
    },
  },

  tenant_audit_gaps: {
    description:
      '[Tenant Ops] Detect gaps in a series of files named with month patterns (e.g. "2025-01", "ENERO", "Enero_2025"). Useful to find missing months in bank statements, payroll, courier reports.',
    inputSchema: {
      type: 'object',
      properties: {
        graph: { type: 'string' },
        parent_key: {
          type: 'string',
          description: 'Folder key whose children will be analyzed',
        },
        expected_year: { type: 'number' },
      },
      required: ['graph', 'parent_key'],
    },
    handler: async ({
      graph,
      parent_key,
      expected_year,
    }: {
      graph: string;
      parent_key: string;
      expected_year?: number;
    }) => {
      const g = await query<{ id: number }>(
        'SELECT id FROM graphs WHERE name = $1',
        [graph],
      );
      if (!g.rows.length) throw new Error(`Graph not found: ${graph}`);

      const children = await query<{ name: string | null }>(
        `SELECT name FROM graph_nodes
         WHERE graph_id = $1 AND parent_key = $2`,
        [g.rows[0].id, parent_key],
      );

      const monthNames = [
        'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
        'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
      ];
      const found = new Set<number>();
      for (const row of children.rows) {
        if (!row.name) continue;
        const lower = row.name.toLowerCase();
        for (let i = 0; i < monthNames.length; i++) {
          if (lower.includes(monthNames[i])) found.add(i + 1);
        }
        const numMatch = lower.match(/(?:^|[-_\s])(\d{1,2})(?:[-_\s]|$)/);
        if (numMatch) {
          const n = parseInt(numMatch[1], 10);
          if (n >= 1 && n <= 12) found.add(n);
        }
      }

      const missing: Array<{ month: number; name: string }> = [];
      for (let i = 1; i <= 12; i++) {
        if (!found.has(i)) missing.push({ month: i, name: monthNames[i - 1] });
      }

      return {
        graph,
        parent_key,
        expected_year: expected_year || null,
        files_in_folder: children.rows.length,
        months_found: Array.from(found).sort((a, b) => a - b),
        months_missing: missing,
      };
    },
  },

  tenant_ms_download_to_dataset: {
    description:
      '[Tenant Ops] Download a OneDrive file into storage/<slug>/datasets/ so it can be parsed with tenant_dataset_read / tenant_dataset_read_excel.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        item_id: { type: 'string', description: 'OneDrive driveItem id' },
        drive_id: {
          type: 'string',
          description: 'Optional — if omitted uses /me/drive',
        },
        filename: {
          type: 'string',
          description: 'Optional override for saved file name',
        },
      },
      required: ['slug', 'item_id'],
    },
    handler: async ({
      slug,
      item_id,
      drive_id,
      filename,
    }: {
      slug: string;
      item_id: string;
      drive_id?: string;
      filename?: string;
    }) => {
      ensureTenantDirs(slug);
      const token = await getValidAccessToken(slug);
      const metaPath = drive_id
        ? `/drives/${drive_id}/items/${item_id}`
        : `/me/drive/items/${item_id}`;
      const metaRes = await fetch(
        `https://graph.microsoft.com/v1.0${metaPath}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!metaRes.ok) {
        throw new Error(`Metadata fetch failed ${metaRes.status}`);
      }
      const meta: any = await metaRes.json();
      const name = filename || meta.name;
      if (!name) throw new Error('Could not resolve filename');

      const contentRes = await fetch(
        `https://graph.microsoft.com/v1.0${metaPath}/content`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!contentRes.ok) {
        throw new Error(`Download failed ${contentRes.status}`);
      }
      const buffer = Buffer.from(await contentRes.arrayBuffer());
      const dest = tenantPath(slug, 'datasets', name);
      writeFileSync(dest, buffer);
      return {
        slug,
        item_id,
        file: name,
        size: buffer.length,
        saved_to: `storage/${slug}/datasets/${name}`,
      };
    },
  },

  tenant_simora_list_mappings: {
    description:
      '[Tenant Ops] List all ETL mappings in simora.folder_mapping (OneDrive folder → DB table rules).',
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      const r = await query(
        `SELECT id, onedrive_key, business_entity, target_table, parser,
                period_pattern, scope, status, metadata
         FROM simora.folder_mapping ORDER BY id`,
      );
      return { mappings: r.rows };
    },
  },

  tenant_simora_ingest_mapping: {
    description:
      '[Tenant Ops] Execute the ETL for a folder_mapping row. Iterates files under onedrive_key, matches period_pattern, downloads via Graph, parses XLSX, and inserts into target_table. Supports parsers: xlsx-courier-monthly, xlsx-bank-monthly. Skips pdf-bank (TODO).',
    inputSchema: {
      type: 'object',
      properties: {
        mapping_id: { type: 'number' },
        dry_run: {
          type: 'boolean',
          description: 'If true, only lists what would be ingested without writes.',
        },
      },
      required: ['mapping_id'],
    },
    handler: async ({
      mapping_id,
      dry_run,
    }: {
      mapping_id: number;
      dry_run?: boolean;
    }) => {
      const mappingRes = await query<any>(
        `SELECT * FROM simora.folder_mapping WHERE id = $1`,
        [mapping_id],
      );
      if (!mappingRes.rows.length) throw new Error(`Mapping ${mapping_id} not found`);
      const mapping = mappingRes.rows[0];

      if (mapping.parser === 'pdf-bank') {
        return {
          mapping_id,
          status: 'skipped',
          reason: 'pdf-bank parser not implemented yet',
        };
      }

      const graphRow = await query<{ id: number }>(
        `SELECT id FROM graphs WHERE name = 'simora-onedrive'`,
      );
      if (!graphRow.rows.length) throw new Error('Graph simora-onedrive not found');

      const files = await query<{
        key: string;
        name: string;
        properties: any;
      }>(
        `SELECT key, name, properties FROM graph_nodes
         WHERE graph_id = $1 AND parent_key = $2 AND type = 'file'
         ORDER BY name`,
        [graphRow.rows[0].id, mapping.onedrive_key],
      );

      const pattern = new RegExp(mapping.period_pattern);
      const monthMap: Record<string, number> = {
        ENE: 1, FEB: 2, MAR: 3, ABR: 4, MAY: 5, JUN: 6,
        JUL: 7, AGO: 8, SEP: 9, OCT: 10, NOV: 11, DIC: 12,
      };

      const results: any[] = [];
      let imported = 0;
      let skipped = 0;
      let errors = 0;

      for (const file of files.rows) {
        const m = file.name.match(pattern);
        if (!m) {
          results.push({ file: file.name, status: 'no_match' });
          skipped++;
          continue;
        }
        const groups = m.groups || {};
        const year =
          parseInt(groups.year, 10) ||
          parseInt(mapping.metadata?.year, 10) ||
          null;
        let month: number | null = null;
        if (groups.month) {
          month =
            /^\d+$/.test(groups.month)
              ? parseInt(groups.month, 10)
              : monthMap[groups.month.toUpperCase()] || null;
        }
        if (!year || !month) {
          results.push({ file: file.name, status: 'period_missing', groups });
          skipped++;
          continue;
        }

        if (dry_run) {
          results.push({
            file: file.name,
            status: 'would_ingest',
            year,
            month,
            target: mapping.target_table,
          });
          continue;
        }

        try {
          // Download file to datasets
          const token = await getValidAccessToken('simora');
          const driveId = file.properties?.drive_id;
          const base = driveId
            ? `/drives/${driveId}/items/${file.key}`
            : `/me/drive/items/${file.key}`;
          const contentRes = await fetch(
            `https://graph.microsoft.com/v1.0${base}/content`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!contentRes.ok) {
            throw new Error(`Download ${contentRes.status}`);
          }
          const buffer = Buffer.from(await contentRes.arrayBuffer());

          // Parse XLSX
          const ExcelJS2 = ExcelJS;
          const wb = new ExcelJS2.Workbook();
          await wb.xlsx.load(buffer as any);
          const sheets: Array<{ name: string; headers: string[]; rows: any[] }> = [];
          for (const ws of wb.worksheets) {
            const headers: string[] = [];
            ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => {
              headers[col - 1] = String(cell.value ?? `col_${col}`);
            });
            const rows: any[] = [];
            for (let r = 2; r <= ws.rowCount; r++) {
              const row = ws.getRow(r);
              if (!row.hasValues) continue;
              const obj: any = {};
              row.eachCell({ includeEmpty: true }, (cell, col) => {
                const key = headers[col - 1] || `col_${col}`;
                const v: any = cell.value;
                obj[key] =
                  v instanceof Date
                    ? v.toISOString()
                    : typeof v === 'object' && v && 'result' in v
                      ? (v as any).result
                      : v;
              });
              rows.push(obj);
            }
            sheets.push({ name: ws.name, headers, rows });
          }

          // Write based on parser
          if (mapping.parser === 'xlsx-courier-monthly') {
            const courier = mapping.metadata?.courier || 'unknown';
            const primarySheet = sheets[0];
            const rowCount = primarySheet?.rows.length || 0;

            const rep = await query<{ id: number }>(
              `INSERT INTO simora.courier_reports
                 (courier, period_year, period_month, source_item_id, source_file_name,
                  source_web_url, row_count, raw_json)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (courier, period_year, period_month) DO UPDATE SET
                 source_item_id = EXCLUDED.source_item_id,
                 source_file_name = EXCLUDED.source_file_name,
                 source_web_url = EXCLUDED.source_web_url,
                 row_count = EXCLUDED.row_count,
                 raw_json = EXCLUDED.raw_json,
                 imported_at = NOW()
               RETURNING id`,
              [
                courier,
                year,
                month,
                file.key,
                file.name,
                file.properties?.web_url,
                rowCount,
                { sheets: sheets.map(s => ({ name: s.name, headers: s.headers, row_count: s.rows.length })) },
              ],
            );
            const reportId = rep.rows[0].id;

            await query(`DELETE FROM simora.courier_deliveries WHERE report_id = $1`, [reportId]);

            for (const row of primarySheet.rows) {
              await query(
                `INSERT INTO simora.courier_deliveries
                   (report_id, tracking_code, raw_row)
                 VALUES ($1, $2, $3)`,
                [reportId, row.tracking || row.Tracking || row.guia || row.GUIA || null, row],
              );
            }

            await query(
              `INSERT INTO simora.import_log (entity_type, entity_id, source_item_id, source_file_name, operation, status, row_count)
               VALUES ('courier_report', $1, $2, $3, 'ingest', 'ok', $4)`,
              [reportId, file.key, file.name, rowCount],
            );

            results.push({ file: file.name, status: 'ingested', report_id: reportId, rows: rowCount });
            imported++;
          } else if (mapping.parser === 'xlsx-bank-monthly') {
            const accountNumber = mapping.metadata?.account_number || 'unknown';
            let accountRow = await query<{ id: number }>(
              `SELECT id FROM simora.bank_accounts WHERE account_number = $1`,
              [accountNumber],
            );
            if (!accountRow.rows.length) {
              accountRow = await query<{ id: number }>(
                `INSERT INTO simora.bank_accounts (account_number, bank_name, currency)
                 VALUES ($1, 'Desconocido', 'COP') RETURNING id`,
                [accountNumber],
              );
            }
            const accountId = accountRow.rows[0].id;
            const primarySheet = sheets[0];
            const rowCount = primarySheet?.rows.length || 0;

            const stmt = await query<{ id: number }>(
              `INSERT INTO simora.bank_statements
                 (account_id, period_year, period_month, source_item_id, source_file_name,
                  source_web_url, row_count, raw_json)
               VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
               ON CONFLICT (account_id, period_year, period_month) DO UPDATE SET
                 source_item_id = EXCLUDED.source_item_id,
                 source_file_name = EXCLUDED.source_file_name,
                 source_web_url = EXCLUDED.source_web_url,
                 row_count = EXCLUDED.row_count,
                 raw_json = EXCLUDED.raw_json,
                 imported_at = NOW()
               RETURNING id`,
              [
                accountId, year, month, file.key, file.name,
                file.properties?.web_url, rowCount,
                { sheets: sheets.map(s => ({ name: s.name, headers: s.headers, row_count: s.rows.length })) },
              ],
            );
            const statementId = stmt.rows[0].id;

            await query(`DELETE FROM simora.bank_transactions WHERE statement_id = $1`, [statementId]);

            for (const row of primarySheet.rows) {
              await query(
                `INSERT INTO simora.bank_transactions (statement_id, raw_row) VALUES ($1, $2)`,
                [statementId, row],
              );
            }

            await query(
              `INSERT INTO simora.import_log (entity_type, entity_id, source_item_id, source_file_name, operation, status, row_count)
               VALUES ('bank_statement', $1, $2, $3, 'ingest', 'ok', $4)`,
              [statementId, file.key, file.name, rowCount],
            );

            results.push({ file: file.name, status: 'ingested', statement_id: statementId, rows: rowCount });
            imported++;
          } else {
            results.push({ file: file.name, status: 'unsupported_parser', parser: mapping.parser });
            skipped++;
          }
        } catch (error: any) {
          errors++;
          await query(
            `INSERT INTO simora.import_log (entity_type, source_item_id, source_file_name, operation, status, error_message)
             VALUES ($1, $2, $3, 'ingest', 'error', $4)`,
            [mapping.business_entity, file.key, file.name, error.message],
          ).catch(() => undefined);
          results.push({ file: file.name, status: 'error', error: error.message });
        }
      }

      return {
        mapping_id,
        mapping: {
          business_entity: mapping.business_entity,
          target_table: mapping.target_table,
          parser: mapping.parser,
        },
        files_total: files.rows.length,
        imported,
        skipped,
        errors,
        dry_run: !!dry_run,
        results,
      };
    },
  },

  tenant_simora_sync_files: {
    description:
      '[Tenant Ops] Download every ingested XLSX/PDF from OneDrive into an organized subtree under storage/simora/datasets/{banking|courier}/... Mirrors source_item_id of simora.bank_statements and simora.courier_reports. Idempotent (skips if already present).',
    inputSchema: {
      type: 'object',
      properties: {
        force: {
          type: 'boolean',
          description:
            'If true, re-downloads even if file already exists on disk.',
        },
      },
    },
    handler: async ({ force }: { force?: boolean }) => {
      const datasetsRoot = tenantPath('simora', 'datasets');
      if (!existsSync(datasetsRoot)) {
        mkdirSync(datasetsRoot, { recursive: true });
      }

      const records: Array<{
        entity: string;
        source_item_id: string;
        source_file_name: string;
        period_year: number;
        period_month: number;
        extra?: string;
      }> = [];

      const couriers = await query<any>(
        `SELECT source_item_id, source_file_name, period_year, period_month, courier
         FROM simora.courier_reports
         WHERE source_item_id IS NOT NULL
         ORDER BY courier, period_year, period_month`,
      );
      for (const row of couriers.rows) {
        records.push({
          entity: 'courier',
          source_item_id: row.source_item_id,
          source_file_name: row.source_file_name,
          period_year: row.period_year,
          period_month: row.period_month,
          extra: row.courier,
        });
      }

      const banks = await query<any>(
        `SELECT s.source_item_id, s.source_file_name, s.period_year, s.period_month,
                a.account_number
         FROM simora.bank_statements s
         JOIN simora.bank_accounts a ON a.id = s.account_id
         WHERE s.source_item_id IS NOT NULL
         ORDER BY a.account_number, s.period_year, s.period_month`,
      );
      for (const row of banks.rows) {
        records.push({
          entity: 'banking',
          source_item_id: row.source_item_id,
          source_file_name: row.source_file_name,
          period_year: row.period_year,
          period_month: row.period_month,
          extra: row.account_number,
        });
      }

      const token = await getValidAccessToken('simora');
      let downloaded = 0;
      let skipped = 0;
      let errors = 0;
      const results: any[] = [];

      for (const r of records) {
        const destDir = tenantPath(
          'simora',
          'datasets',
          r.entity,
          r.extra || 'unknown',
          String(r.period_year),
        );
        if (!existsSync(destDir)) {
          mkdirSync(destDir, { recursive: true });
        }
        const destPath = pathJoin(destDir, r.source_file_name);

        if (!force && existsSync(destPath)) {
          skipped++;
          results.push({
            file: r.source_file_name,
            status: 'already_present',
          });
          continue;
        }

        try {
          const url = `https://graph.microsoft.com/v1.0/me/drive/items/${r.source_item_id}/content`;
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) {
            throw new Error(`download ${res.status}`);
          }
          const buffer = Buffer.from(await res.arrayBuffer());
          writeFileSync(destPath, buffer);
          downloaded++;
          results.push({
            file: r.source_file_name,
            status: 'downloaded',
            bytes: buffer.length,
            path: pathRelative(tenantPath('simora'), destPath),
          });
        } catch (error: any) {
          errors++;
          results.push({
            file: r.source_file_name,
            status: 'error',
            error: error.message,
          });
        }
      }

      return {
        total: records.length,
        downloaded,
        skipped,
        errors,
        results,
      };
    },
  },

  tenant_simora_query: {
    description:
      '[Tenant Ops] Read-only SQL query against the simora schema (tables: bank_accounts, bank_statements, bank_transactions, courier_reports, courier_deliveries, daily_planillas, folder_mapping, import_log). Safe — SELECT only.',
    inputSchema: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'SELECT statement only' },
      },
      required: ['sql'],
    },
    handler: async ({ sql }: { sql: string }) => {
      const trimmed = sql.trim().toLowerCase();
      if (!trimmed.startsWith('select') && !trimmed.startsWith('with')) {
        throw new Error('Only SELECT / WITH queries allowed');
      }
      if (/;\s*\S/.test(sql)) {
        throw new Error('Only a single statement allowed');
      }
      const r = await query(sql);
      return { rows: r.rows, row_count: r.rowCount };
    },
  },

  // ────────────────────────── REPORTS ──────────────────────────
  tenant_report_save: {
    description:
      '[Tenant Ops] Save a generated report (markdown) into storage/<slug>/reports/.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: tenantProp,
        name: { type: 'string', description: 'e.g. 2026-04-reconciliation' },
        content: { type: 'string' },
      },
      required: ['slug', 'name', 'content'],
    },
    handler: async ({
      slug,
      name,
      content,
    }: {
      slug: string;
      name: string;
      content: string;
    }) => {
      assertName(name, 'report name');
      ensureTenantDirs(slug);
      const p = tenantPath(slug, 'reports', `${name}.md`);
      writeText(p, content);
      return { ok: true, path: `storage/${slug}/reports/${name}.md` };
    },
  },

  tenant_report_list: {
    description: '[Tenant Ops] List generated reports for a tenant.',
    inputSchema: {
      type: 'object',
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => ({
      slug,
      reports: listFiles(tenantPath(slug, 'reports'), ['.md']),
    }),
  },

  // ─────────────────────── PYTHON AUDIT WORKFLOW ───────────────────────

  tenant_audit_script_save: {
    description:
      '[Tenant Audit] Save or update a Python audit script in storage/<slug>/scripts/. ' +
      'Scripts receive --dataset <abs_path> and --params <json> as CLI args. ' +
      'Must print a single JSON object to stdout.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: tenantProp,
        path: {
          type: 'string',
          description: 'Relative path inside scripts/, e.g. "contabilidad/01_resumen.py"',
        },
        content: { type: 'string', description: 'Full Python script source' },
      },
      required: ['slug', 'path', 'content'],
    },
    handler: async ({
      slug,
      path: scriptPath,
      content,
    }: {
      slug: string;
      path: string;
      content: string;
    }) => {
      if (scriptPath.includes('..') || !scriptPath.endsWith('.py')) {
        throw new Error('Invalid script path — must end in .py and not contain ".."');
      }
      ensureTenantDirs(slug);
      const full = tenantPath(slug, 'scripts', scriptPath);
      writeText(full, content);
      return { ok: true, path: `storage/${slug}/scripts/${scriptPath}` };
    },
  },

  tenant_audit_script_list: {
    description:
      '[Tenant Audit] List all Python audit scripts available for a tenant (recursive).',
    inputSchema: {
      type: 'object' as const,
      properties: { slug: tenantProp },
      required: ['slug'],
    },
    handler: async ({ slug }: { slug: string }) => {
      ensureTenantDirs(slug);
      const scriptsDir = tenantPath(slug, 'scripts');
      return {
        slug,
        scripts: listFilesRecursive(scriptsDir, ['.py']),
      };
    },
  },

  tenant_audit_script_get: {
    description: '[Tenant Audit] Read the source of a Python audit script.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: tenantProp,
        path: {
          type: 'string',
          description: 'Relative path e.g. "contabilidad/01_resumen.py"',
        },
      },
      required: ['slug', 'path'],
    },
    handler: async ({
      slug,
      path: scriptPath,
    }: {
      slug: string;
      path: string;
    }) => {
      if (scriptPath.includes('..')) throw new Error('Invalid path');
      const full = tenantPath(slug, 'scripts', scriptPath);
      if (!existsSync(full)) throw new Error(`Script not found: ${scriptPath}`);
      return { slug, path: scriptPath, content: readText(full) };
    },
  },

  tenant_audit_run: {
    description:
      '[Tenant Audit] Execute a Python audit script against an optional dataset. ' +
      'The script receives --dataset <abs_path> and --params <json> as CLI args. ' +
      'It must print a single JSON object to stdout. ' +
      'Optionally saves the result to reports/ with a timestamped filename.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: tenantProp,
        script: {
          type: 'string',
          description: 'Script path relative to scripts/, e.g. "contabilidad/01_resumen.py"',
        },
        dataset: {
          type: 'string',
          description: 'Optional dataset filename in datasets/, e.g. "compras_2025_01.xlsx"',
        },
        params: {
          type: 'object',
          description: 'Optional key-value params passed as --params <json> to the script',
        },
        save_report: {
          type: 'boolean',
          description: 'If true, save JSON output to reports/ with a timestamp',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Execution timeout in seconds (default 120, max 600)',
        },
      },
      required: ['slug', 'script'],
    },
    handler: async ({
      slug,
      script,
      dataset,
      params,
      save_report,
      timeout_seconds,
    }: {
      slug: string;
      script: string;
      dataset?: string;
      params?: Record<string, unknown>;
      save_report?: boolean;
      timeout_seconds?: number;
    }) => {
      if (script.includes('..') || !script.endsWith('.py')) {
        throw new Error('Invalid script path');
      }
      const scriptFull = tenantPath(slug, 'scripts', script);
      if (!existsSync(scriptFull)) throw new Error(`Script not found: ${script}`);

      const args: string[] = [scriptFull];
      if (dataset) {
        const datasetFull = tenantPath(slug, 'datasets', dataset);
        if (!existsSync(datasetFull)) throw new Error(`Dataset not found: ${dataset}`);
        args.push('--dataset', datasetFull);
      }
      if (params) {
        args.push('--params', JSON.stringify(params));
      }

      const timeoutMs = Math.min((timeout_seconds ?? 120) * 1000, 600_000);
      const py = spawnSync('python3', args, {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      });

      if (py.error) {
        throw new Error(`Failed to spawn Python: ${py.error.message}`);
      }

      const stderr = py.stderr?.trim() || undefined;
      let output: unknown;
      try {
        output = JSON.parse(py.stdout || '{}');
      } catch {
        output = { raw_output: py.stdout?.trim() };
      }

      if (save_report) {
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const reportName = script.replace(/\//g, '__').replace('.py', '');
        const reportPath = tenantPath(slug, 'reports', `audit__${reportName}__${ts}.json`);
        writeJson(reportPath, {
          script,
          dataset: dataset ?? null,
          params: params ?? null,
          ran_at: new Date().toISOString(),
          exit_code: py.status,
          output,
          ...(stderr ? { warnings: stderr } : {}),
        });
      }

      return {
        ok: py.status === 0,
        exit_code: py.status,
        output,
        ...(stderr ? { warnings: stderr } : {}),
      };
    },
  },

  tenant_audit_report_get: {
    description:
      '[Tenant Audit] Read a JSON report saved by tenant_audit_run. ' +
      'Use tenant_report_list to see available reports.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        slug: tenantProp,
        name: {
          type: 'string',
          description: 'Report filename without extension, e.g. "audit__contabilidad__01_resumen__2026-04-17T20-00-00"',
        },
      },
      required: ['slug', 'name'],
    },
    handler: async ({ slug, name }: { slug: string; name: string }) => {
      if (name.includes('..')) throw new Error('Invalid name');
      const p = tenantPath(slug, 'reports', `${name}.json`);
      if (!existsSync(p)) throw new Error(`Report not found: ${name}`);
      return readJson(p);
    },
  },
};
