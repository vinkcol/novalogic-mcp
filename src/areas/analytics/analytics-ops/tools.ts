/**
 * Analytics Ops — simora_v2 analytical schema tools.
 * Reutilizable por cualquier empresa via company_slug.
 */

import { api } from '../../../services/api-client.js';

function err(message: string) { return { error: message }; }

export const tools = {

  // ─── ETL ORCHESTRATION ──────────────────────────────────────

  analytics_etl_start: {
    description:
      '[Analytics] Inicia un ETL run y retorna un run_id para rastrear el proceso. ' +
      'Llama antes de insertar datos; cierra con analytics_etl_finish.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_slug: { type: 'string', description: 'e.g. "simora"' },
        source: { type: 'string', enum: ['legacy_mongo', 'novalogic', 'onedrive', 'manual'] },
        entity: { type: 'string', description: 'e.g. "orders", "customers"' },
        metadata: { type: 'object', description: 'Contexto adicional del ETL' },
      },
      required: ['company_slug', 'source', 'entity'],
    },
    handler: async (args: any) => {
      const res = await api.post('/analytics/etl/start', args);
      if (!res.ok) return err(`ETL start failed: ${res.status}`);
      return res.data;
    },
  },

  analytics_etl_finish: {
    description: '[Analytics] Cierra un ETL run con conteos y estado final.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        run_id: { type: 'string' },
        processed: { type: 'number' },
        inserted:  { type: 'number' },
        updated:   { type: 'number' },
        failed:    { type: 'number' },
        status:    { type: 'string', enum: ['completed', 'failed'] },
        error_log: { type: 'string' },
      },
      required: ['run_id', 'processed', 'inserted', 'updated', 'failed'],
    },
    handler: async (args: any) => {
      const { run_id, ...body } = args;
      const res = await api.post(`/analytics/etl/${run_id}/finish`, body);
      if (!res.ok) return err(`ETL finish failed: ${res.status}`);
      return res.data;
    },
  },

  analytics_etl_list: {
    description: '[Analytics] Lista los últimos ETL runs de una empresa con sus conteos y estado.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_slug: { type: 'string' },
        limit: { type: 'number', description: 'Default 20' },
      },
      required: ['company_slug'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/analytics/etl/runs?company_slug=${args.company_slug}&limit=${args.limit ?? 20}`);
      if (!res.ok) return err(`Failed: ${res.status}`);
      return res.data;
    },
  },

  analytics_etl_get: {
    description: '[Analytics] Obtiene el detalle de un ETL run específico.',
    inputSchema: {
      type: 'object' as const,
      properties: { run_id: { type: 'string' } },
      required: ['run_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/analytics/etl/runs/${args.run_id}`);
      if (!res.ok) return err(`Not found: ${res.status}`);
      return res.data;
    },
  },

  // ─── UPSERT (usado por ETL Python y carga manual) ────────────

  analytics_upsert_customers: {
    description:
      '[Analytics] Inserta/actualiza clientes en simora_v2.dim_customers. ' +
      'Cada fila: { source, source_id, full_name, first_name, last_name, email, phone, city, department, address, raw }',
    inputSchema: {
      type: 'object' as const,
      properties: {
        rows: { type: 'array', items: { type: 'object' }, description: 'Array de customers' },
      },
      required: ['rows'],
    },
    handler: async (args: any) => {
      const res = await api.post('/analytics/upsert/customers', { rows: args.rows });
      if (!res.ok) return err(`Upsert failed: ${res.status}`);
      return res.data;
    },
  },

  analytics_upsert_products: {
    description:
      '[Analytics] Inserta/actualiza productos en simora_v2.dim_products. ' +
      'Cada fila: { source, source_id, sku, name, category, brand, unit_price, raw }',
    inputSchema: {
      type: 'object' as const,
      properties: {
        rows: { type: 'array', items: { type: 'object' } },
      },
      required: ['rows'],
    },
    handler: async (args: any) => {
      const res = await api.post('/analytics/upsert/products', { rows: args.rows });
      if (!res.ok) return err(`Upsert failed: ${res.status}`);
      return res.data;
    },
  },

  analytics_upsert_sellers: {
    description:
      '[Analytics] Inserta/actualiza vendedores en simora_v2.dim_sellers. ' +
      'Cada fila: { source, source_id, full_name, email, phone, role, branch, raw }',
    inputSchema: {
      type: 'object' as const,
      properties: {
        rows: { type: 'array', items: { type: 'object' } },
      },
      required: ['rows'],
    },
    handler: async (args: any) => {
      const res = await api.post('/analytics/upsert/sellers', { rows: args.rows });
      if (!res.ok) return err(`Upsert failed: ${res.status}`);
      return res.data;
    },
  },

  analytics_upsert_orders: {
    description:
      '[Analytics] Inserta/actualiza pedidos en simora_v2.fact_orders. ' +
      'Cada fila: { source, source_id, tracking_code, customer_source_id, seller_source_id, ' +
      'order_date, subtotal, iva, shipping_cost, total, payment_type, guide_number, city, department, raw }',
    inputSchema: {
      type: 'object' as const,
      properties: {
        rows: { type: 'array', items: { type: 'object' } },
      },
      required: ['rows'],
    },
    handler: async (args: any) => {
      const res = await api.post('/analytics/upsert/orders', { rows: args.rows });
      if (!res.ok) return err(`Upsert failed: ${res.status}`);
      return res.data;
    },
  },

  analytics_upsert_order_items: {
    description:
      '[Analytics] Inserta items de un pedido en simora_v2.fact_order_items. ' +
      'Reemplaza todos los items del pedido (idempotente).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        source:    { type: 'string' },
        source_id: { type: 'string', description: 'source_id del pedido padre' },
        items: {
          type: 'array',
          items: { type: 'object' },
          description: '[ { source_product_id, product_name, quantity, unit_price, total } ]',
        },
      },
      required: ['source', 'source_id', 'items'],
    },
    handler: async (args: any) => {
      const res = await api.post('/analytics/upsert/order-items', args);
      if (!res.ok) return err(`Upsert failed: ${res.status}`);
      return res.data;
    },
  },

  // ─── ANALYTICS QUERIES ──────────────────────────────────────

  analytics_summary: {
    description:
      '[Analytics] Resumen financiero completo de simora_v2: totales de ingresos, IVA, envíos, ' +
      'promedio por pedido, breakdown por fuente, método de pago y tendencia mensual.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_slug: { type: 'string', description: 'e.g. "simora"' },
      },
      required: ['company_slug'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/analytics/summary?company_slug=${args.company_slug}`);
      if (!res.ok) return err(`Failed: ${res.status}`);
      return res.data;
    },
  },

  analytics_table_counts: {
    description:
      '[Analytics] Conteo de filas en todas las tablas de simora_v2. ' +
      'Útil para verificar estado del ETL y completitud de la carga.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/analytics/table-counts');
      if (!res.ok) return err(`Failed: ${res.status}`);
      return res.data;
    },
  },
};
