/**
 * Internal Audit Agent — Consulta del log de auditoría de la Internal API
 * Tabla: security.internal_audit_logs
 */

import { api } from '../../../../services/api-client.js';

function err(message: string) {
  return { error: message };
}

function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

export const tools = {

  internal_audit_logs: {
    description:
      '[Internal Audit] Consultar el log de auditoría de la Internal API. ' +
      'Filtra por recurso/URL (fragment), método HTTP, resultado (success|error) y rango de fechas. ' +
      'Cada entrada incluye responsable (api_key_name), company_id, timestamp y endpoint exacto.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        resource: {
          type: 'string',
          description: 'Fragmento de URL a buscar (ej: "link-product", "VTA-0316", "inventory/adjustment")',
        },
        action: {
          type: 'string',
          description: 'Método HTTP: GET, POST, PATCH, PUT, DELETE',
        },
        response_status: {
          type: 'string',
          description: 'Resultado de la operación: success | error',
        },
        from: {
          type: 'string',
          description: 'Fecha inicio ISO8601 (ej: 2026-04-18T00:00:00Z)',
        },
        to: {
          type: 'string',
          description: 'Fecha fin ISO8601',
        },
        api_key_id: {
          type: 'string',
          description: 'UUID del api key para filtrar por cliente específico',
        },
        page: { type: 'number', description: 'Página (default 1)' },
        limit: { type: 'number', description: 'Registros por página (default 50, max 200)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.resource) params.set('resource', args.resource);
      if (args.action) params.set('action', args.action);
      if (args.response_status) params.set('responseStatus', args.response_status);
      if (args.from) params.set('from', args.from);
      if (args.to) params.set('to', args.to);
      if (args.api_key_id) params.set('apiKeyId', args.api_key_id);
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));

      const res = await api.get(`/audit/logs?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

  internal_audit_recent: {
    description:
      '[Internal Audit] Obtener las últimas N operaciones registradas en el audit log de la Internal API. ' +
      'Retorna entradas ordenadas por timestamp DESC con responsable y endpoint.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Número de registros recientes (default 20, max 200)' },
        response_status: {
          type: 'string',
          description: 'Filtrar solo errores o éxitos: success | error',
        },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      params.set('limit', String(args.limit ?? 20));
      params.set('page', '1');
      if (args.response_status) params.set('responseStatus', args.response_status);

      const res = await api.get(`/audit/logs?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

};
