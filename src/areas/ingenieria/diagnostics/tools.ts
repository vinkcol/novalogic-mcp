/**
 * Diagnostics Agent — Query operational errors captured by API telemetry.
 * Reads from /internal/telemetry/diagnostics (Mongo-backed) via REST.
 */

import { api } from '../../../services/api-client.js';

function err(message: string) {
  return { error: message };
}
function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

export const tools = {
  diag_recent: {
    description: '[Diagnostics] List most recent errors captured in the current env.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        env: { type: 'string', description: 'development | production' },
        limit: { type: 'number', description: 'Max results (default 20)' },
        path: { type: 'string', description: 'Filter by path substring' },
        company_id: { type: 'string', description: 'Filter by companyId' },
        status_code: { type: 'number', description: 'Exact HTTP status' },
        min_status: { type: 'number', description: 'Minimum HTTP status (e.g. 500 for only server errors)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.env) params.set('env', args.env);
      params.set('limit', String(args.limit ?? 20));
      if (args.path) params.set('path', args.path);
      if (args.company_id) params.set('companyId', args.company_id);
      if (args.status_code) params.set('statusCode', String(args.status_code));
      if (args.min_status) params.set('minStatusCode', String(args.min_status));
      const res = await api.get(`/telemetry/diagnostics/errors?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

  diag_get: {
    description: '[Diagnostics] Get full diagnostic event by traceId (stack, body, headers, SQL).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        trace_id: { type: 'string', description: 'traceId UUID' },
      },
      required: ['trace_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/telemetry/diagnostics/errors/${args.trace_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ event: res.data });
    },
  },

  diag_top_errors: {
    description: '[Diagnostics] Top N error groups aggregated by {path, exceptionClass, status} in time window.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        env: { type: 'string', description: 'development | production' },
        window: { type: 'string', description: 'Time window: 30m, 1h, 6h, 24h (default 1h)' },
        limit: { type: 'number', description: 'Max groups (default 20)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.env) params.set('env', args.env);
      if (args.window) params.set('windowMs', args.window);
      if (args.limit) params.set('limit', String(args.limit));
      const res = await api.get(`/telemetry/diagnostics/errors/top?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

  diag_stats: {
    description: '[Diagnostics] Error counts by status code in time window.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        env: { type: 'string', description: 'development | production' },
        window_ms: { type: 'number', description: 'Window in ms (default 3600000 = 1h)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.env) params.set('env', args.env);
      if (args.window_ms) params.set('windowMs', String(args.window_ms));
      const res = await api.get(`/telemetry/diagnostics/errors/stats?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

  diag_replay_curl: {
    description: '[Diagnostics] Build a curl command to reproduce a captured request locally. Redacted body/headers; headers like x-api-key left as placeholder.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        trace_id: { type: 'string', description: 'traceId UUID' },
        base_url: {
          type: 'string',
          description: 'Base URL to target (default http://localhost:3005/api/v1)',
        },
      },
      required: ['trace_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/telemetry/diagnostics/errors/${args.trace_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      const ev: any = res.data;
      const baseUrl = args.base_url ?? 'http://localhost:3005/api/v1';
      const path = ev.request?.path ?? '';
      const method = ev.request?.method ?? 'GET';
      const bodyJson = ev.request?.body ? JSON.stringify(ev.request.body) : undefined;
      const headerLines = [
        `-H "x-api-key: <PUT_YOUR_LOCAL_KEY>"`,
        bodyJson ? `-H "content-type: application/json"` : undefined,
      ].filter(Boolean);
      const bodyArg = bodyJson ? `--data '${bodyJson.replace(/'/g, "'\\''")}'` : '';
      const curlCommand = `curl -X ${method} ${headerLines.join(' ')} ${bodyArg} "${baseUrl}${path.replace(/^\/api\/v1/, '')}"`;
      return ok({
        traceId: ev.traceId,
        statusCode: ev.statusCode,
        exception: ev.error?.exceptionClass,
        message: ev.error?.message,
        curlCommand,
      });
    },
  },
};
