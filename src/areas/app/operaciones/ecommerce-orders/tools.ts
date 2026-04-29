import { api } from '../../../../services/api-client.js';

function err(message: string) {
  return { error: message };
}

function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

export const tools = {
  ecommerce_orders_list: {
    description:
      '[Ecommerce Orders] Listar órdenes de la tienda virtual (origin=ECOMMERCE) con filtros opcionales.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'number', description: 'Página (default: 1)' },
        limit: { type: 'number', description: 'Tamaño de página (default: 20)' },
        status: {
          type: 'string',
          description: 'Estado de la orden (PENDING, CONFIRMED, etc)',
        },
        date_from: { type: 'string', description: 'Fecha desde (ISO)' },
        date_to: { type: 'string', description: 'Fecha hasta (ISO)' },
        customer_id: { type: 'string', description: 'UUID del cliente' },
        search_term: { type: 'string', description: 'Búsqueda libre' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      if (args.status) params.set('status', args.status);
      if (args.date_from) params.set('dateFrom', args.date_from);
      if (args.date_to) params.set('dateTo', args.date_to);
      if (args.customer_id) params.set('customerId', args.customer_id);
      if (args.search_term) params.set('searchTerm', args.search_term);
      const qs = params.toString();
      const res = await api.get(`/ecommerce/orders${qs ? '?' + qs : ''}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ orders: res.data });
    },
  },

  ecommerce_orders_get: {
    description:
      '[Ecommerce Orders] Obtener detalle de una orden ecommerce por ID (tenant-scoped).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID de la orden' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.get(`/ecommerce/orders/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ order: res.data });
    },
  },
};
