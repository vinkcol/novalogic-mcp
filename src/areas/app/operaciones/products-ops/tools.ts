/**
 * Products Ops Agent — Product Catalog Management via Internal API
 */

import { api } from '../../../../services/api-client.js';

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

export const tools = {

  products_ops_list: {
    description: '[Products Ops] Listar productos con paginacion y filtros.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'number', description: 'Pagina (default 1)' },
        page_size: { type: 'number', description: 'Items por pagina (default 20)' },
        search: { type: 'string', description: 'Buscar por nombre o SKU' },
        category: { type: 'string', description: 'Filtrar por categoria' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.page_size) params.set('pageSize', String(args.page_size));
      if (args.search) params.set('search', args.search);
      if (args.category) params.set('category', args.category);
      const res = await api.get(`/products?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ products: res.data });
    },
  },

  products_ops_get: {
    description: '[Products Ops] Obtener detalle de un producto por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
      },
      required: ['product_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/products/${args.product_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ product: res.data });
    },
  },

  products_ops_create: {
    description: '[Products Ops] Crear nuevo producto.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre del producto' },
        sku: { type: 'string', description: 'SKU unico' },
        price: { type: 'number', description: 'Precio de venta' },
        cost: { type: 'number', description: 'Costo (opcional)' },
        category_id: { type: 'string', description: 'UUID de categoria' },
        description: { type: 'string', description: 'Descripcion' },
        stock: { type: 'number', description: 'Stock inicial' },
      },
      required: ['name', 'price'],
    },
    handler: async (args: any) => {
      const res = await api.post('/products', {
        name: args.name,
        sku: args.sku,
        price: args.price,
        cost: args.cost,
        categoryId: args.category_id,
        description: args.description,
        stock: args.stock,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ product: res.data }, 'Producto creado');
    },
  },

  products_ops_update: {
    description: '[Products Ops] Actualizar un producto.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
        name: { type: 'string' },
        price: { type: 'number' },
        cost: { type: 'number' },
        description: { type: 'string' },
        sku: { type: 'string' },
      },
      required: ['product_id'],
    },
    handler: async (args: any) => {
      const { product_id, ...data } = args;
      const res = await api.put(`/products/${product_id}`, data);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ product: res.data }, 'Producto actualizado');
    },
  },

  products_ops_delete: {
    description: '[Products Ops] Eliminar un producto (soft delete).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
      },
      required: ['product_id'],
    },
    handler: async (args: any) => {
      const res = await api.del(`/products/${args.product_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Producto eliminado');
    },
  },

  products_ops_activate: {
    description: '[Products Ops] Activar un producto desactivado.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
      },
      required: ['product_id'],
    },
    handler: async (args: any) => {
      const res = await api.patch(`/products/${args.product_id}/activate`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ product: res.data }, 'Producto activado');
    },
  },

  products_ops_deactivate: {
    description: '[Products Ops] Desactivar un producto.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
      },
      required: ['product_id'],
    },
    handler: async (args: any) => {
      const res = await api.patch(`/products/${args.product_id}/deactivate`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ product: res.data }, 'Producto desactivado');
    },
  },

  products_ops_categories: {
    description: '[Products Ops] Listar categorias de productos.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/products/categories/list');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ categories: res.data });
    },
  },

  products_ops_create_category: {
    description: '[Products Ops] Crear nueva categoria de productos.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre de la categoria' },
        description: { type: 'string', description: 'Descripcion (opcional)' },
        parent_id: { type: 'string', description: 'UUID de categoria padre (opcional)' },
      },
      required: ['name'],
    },
    handler: async (args: any) => {
      const body: any = { name: args.name };
      if (args.description) body.description = args.description;
      if (args.parent_id) body.parentId = args.parent_id;
      const res = await api.post('/products/categories', body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ category: res.data });
    },
  },

  products_ops_set_price: {
    description: '[Products Ops] Registrar nuevo precio para un producto. Crea una versión en el historial de precios y actualiza el precio actual. Permite rastrear cambios de precio con fecha efectiva y motivo.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
        price: { type: 'number', description: 'Nuevo precio de venta (COP)' },
        cost: { type: 'number', description: 'Costo del producto (opcional)' },
        reason: { type: 'string', description: 'Motivo del cambio de precio (ej: "ajuste inflación", "campaña Facebook")' },
        effective_from: { type: 'string', description: 'Fecha efectiva ISO 8601 (default: ahora). Ej: 2025-04-01T00:00:00Z' },
      },
      required: ['product_id', 'price'],
    },
    handler: async (args: any) => {
      const body: any = { price: args.price };
      if (args.cost !== undefined) body.cost = args.cost;
      if (args.reason) body.reason = args.reason;
      if (args.effective_from) body.effectiveFrom = args.effective_from;
      const res = await api.post(`/products/${args.product_id}/prices`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ entry: res.data }, 'Precio registrado correctamente');
    },
  },

  products_ops_price_history: {
    description: '[Products Ops] Historial completo de precios de un producto con fechas efectivas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
      },
      required: ['product_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/products/${args.product_id}/prices`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

  products_ops_price_current: {
    description: '[Products Ops] Obtener el precio vigente de un producto (última versión activa).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
      },
      required: ['product_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/products/${args.product_id}/prices/current`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

  products_ops_price_at: {
    description: '[Products Ops] Consultar el precio de un producto en una fecha específica. Útil para auditoría y cálculo de márgenes históricos.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
        date: { type: 'string', description: 'Fecha ISO 8601 (ej: 2025-04-01)' },
      },
      required: ['product_id', 'date'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/products/${args.product_id}/prices/at?date=${encodeURIComponent(args.date)}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },
};
