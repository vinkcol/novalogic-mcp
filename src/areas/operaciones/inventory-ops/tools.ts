/**
 * Inventory Ops Agent — Stock & Inventory Management via Internal API
 */

import { api } from '../../../services/api-client.js';

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

export const tools = {

  inventory_ops_list: {
    description: '[Inventory Ops] Listar items de inventario con filtros.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Buscar por nombre o SKU' },
        category: { type: 'string', description: 'Filtrar por categoria' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.search) params.set('search', args.search);
      if (args.category) params.set('category', args.category);
      const res = await api.get(`/inventory/items?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ items: res.data });
    },
  },

  inventory_ops_get: {
    description: '[Inventory Ops] Obtener detalle de un item de inventario.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        item_id: { type: 'string', description: 'UUID del item' },
      },
      required: ['item_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/inventory/items/${args.item_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ item: res.data });
    },
  },

  inventory_ops_create: {
    description: '[Inventory Ops] Crear nuevo item de inventario a partir de un producto existente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto existente' },
        stock: { type: 'number', description: 'Stock inicial (default 0)' },
        min_stock: { type: 'number', description: 'Stock minimo para alerta (default 0)' },
      },
      required: ['product_id'],
    },
    handler: async (args: any) => {
      const res = await api.post('/inventory/item', {
        productId: args.product_id,
        stock: args.stock ?? 0,
        minimumStock: args.min_stock ?? 0,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ item: res.data }, 'Item de inventario creado');
    },
  },

  inventory_ops_adjust: {
    description: '[Inventory Ops] Ajustar stock de un item (agregar o quitar unidades).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        item_id: { type: 'string', description: 'UUID del item' },
        variant_id: { type: 'string', description: 'UUID de variante de inventario (opcional)' },
        quantity: { type: 'number', description: 'Cantidad a ajustar (positivo=agregar, negativo=quitar)' },
        type: { type: 'string', enum: ['entry', 'exit', 'adjustment'], description: 'Tipo de movimiento. Default: entry si quantity>0, exit si quantity<0' },
        reason: { type: 'string', description: 'Razon del ajuste (obligatorio)' },
        reference: { type: 'string', description: 'Referencia externa (opcional)' },
      },
      required: ['item_id', 'quantity', 'reason'],
    },
    handler: async (args: any) => {
      const qty = Number(args.quantity);
      const type = args.type ?? (qty >= 0 ? 'entry' : 'exit');
      const absQty = Math.abs(qty);
      const res = await api.post('/inventory/adjustment', {
        itemId: args.item_id,
        variantId: args.variant_id,
        quantity: absQty,
        type,
        reason: args.reason,
        reference: args.reference,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ movement: res.data }, `Stock ajustado (${type}): ${absQty}`);
    },
  },

  inventory_ops_movements: {
    description: '[Inventory Ops] Listar movimientos de stock (entradas, salidas, ajustes).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        item_id: { type: 'string', description: 'UUID del item (opcional, filtra por item)' },
      },
    },
    handler: async (args: any) => {
      const params = args.item_id ? `?itemId=${args.item_id}` : '';
      const res = await api.get(`/inventory/movements${params}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ movements: res.data });
    },
  },

  inventory_ops_categories: {
    description: '[Inventory Ops] Listar categorias de inventario.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/inventory/category');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ categories: res.data });
    },
  },

  inventory_ops_delete: {
    description: '[Inventory Ops] Eliminar item de inventario (soft delete).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        item_id: { type: 'string', description: 'UUID del item' },
      },
      required: ['item_id'],
    },
    handler: async (args: any) => {
      const res = await api.del(`/inventory/item/${args.item_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Item eliminado');
    },
  },

  inventory_ops_update: {
    description:
      '[Inventory Ops] Actualizar configuración de un item de inventario: stock mínimo (minimum_stock), stock máximo (max_stock) y ubicación (location). Cambio queda registrado en log de auditoría interno.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        item_id: { type: 'string', description: 'UUID del item de inventario' },
        minimum_stock: {
          type: 'number',
          description: 'Stock mínimo para alertas de reorden (ej: 50)',
        },
        max_stock: {
          type: 'number',
          description: 'Stock máximo de referencia (ej: 500)',
        },
        location: {
          type: 'string',
          description: 'Ubicación física en bodega (ej: "Estante A3")',
        },
      },
      required: ['item_id'],
    },
    handler: async (args: any) => {
      const body: Record<string, any> = {};
      if (args.minimum_stock !== undefined) body.minimum_stock = args.minimum_stock;
      if (args.max_stock !== undefined) body.max_stock = args.max_stock;
      if (args.location !== undefined) body.location = args.location;
      const res = await api.patch(`/inventory/${args.item_id}/settings`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ item: res.data }, `Configuración actualizada para item ${args.item_id}`);
    },
  },

  inventory_ops_alerts: {
    description: '[Inventory Ops] Items con stock por debajo del mínimo configurado. Devuelve nombre, SKU, stock actual, mínimo y déficit.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async (_args: any) => {
      const res = await api.get('/inventory/alerts');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },
};
