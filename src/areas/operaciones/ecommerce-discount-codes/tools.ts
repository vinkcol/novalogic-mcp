import { api } from '../../../services/api-client.js';

function err(message: string) {
  return { error: message };
}

function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

export const tools = {
  ecommerce_discount_codes_list: {
    description: '[Ecommerce Discount Codes] Listar códigos de descuento.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
      },
    },
    handler: async (args: any) => {
      const qs = args.site_id ? `?siteId=${args.site_id}` : '';
      const res = await api.get(`/ecommerce/discount-codes${qs}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ codes: res.data });
    },
  },

  ecommerce_discount_codes_get: {
    description: '[Ecommerce Discount Codes] Obtener un código de descuento por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.get(`/ecommerce/discount-codes/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ code: res.data });
    },
  },

  ecommerce_discount_codes_create: {
    description: '[Ecommerce Discount Codes] Crear un código de descuento/cupón.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string' },
        code: { type: 'string', description: 'Código que el cliente ingresa (ej: VERANO20)' },
        description: { type: 'string' },
        discount_type: { type: 'string', description: 'percentage | fixed' },
        discount_value: { type: 'number' },
        applies_to: {
          type: 'string',
          description: 'all_products | specific_products | specific_collections',
        },
        min_purchase: { type: 'number', description: 'Compra mínima (opcional)' },
        max_uses: { type: 'number', description: 'Usos totales máximos' },
        max_uses_per_customer: { type: 'number' },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        is_active: { type: 'boolean' },
      },
      required: ['code', 'discount_type', 'discount_value'],
    },
    handler: async (args: any) => {
      const body = {
        siteId: args.site_id,
        code: args.code,
        description: args.description,
        discountType: args.discount_type,
        discountValue: args.discount_value,
        appliesTo: args.applies_to,
        minPurchase: args.min_purchase,
        maxUses: args.max_uses,
        maxUsesPerCustomer: args.max_uses_per_customer,
        startDate: args.start_date,
        endDate: args.end_date,
        isActive: args.is_active,
      };
      const res = await api.post('/ecommerce/discount-codes', body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ code: res.data }, 'Código creado');
    },
  },

  ecommerce_discount_codes_update: {
    description: '[Ecommerce Discount Codes] Actualizar un código existente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        description: { type: 'string' },
        discount_value: { type: 'number' },
        min_purchase: { type: 'number' },
        max_uses: { type: 'number' },
        max_uses_per_customer: { type: 'number' },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        is_active: { type: 'boolean' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const body: any = {};
      if (args.description !== undefined) body.description = args.description;
      if (args.discount_value !== undefined) body.discountValue = args.discount_value;
      if (args.min_purchase !== undefined) body.minPurchase = args.min_purchase;
      if (args.max_uses !== undefined) body.maxUses = args.max_uses;
      if (args.max_uses_per_customer !== undefined)
        body.maxUsesPerCustomer = args.max_uses_per_customer;
      if (args.start_date !== undefined) body.startDate = args.start_date;
      if (args.end_date !== undefined) body.endDate = args.end_date;
      if (args.is_active !== undefined) body.isActive = args.is_active;
      const res = await api.put(`/ecommerce/discount-codes/${args.id}`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ code: res.data }, 'Código actualizado');
    },
  },

  ecommerce_discount_codes_delete: {
    description: '[Ecommerce Discount Codes] Eliminar un código de descuento.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.del(`/ecommerce/discount-codes/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Código eliminado');
    },
  },

  ecommerce_discount_codes_set_products: {
    description:
      '[Ecommerce Discount Codes] Asignar productos al alcance del código (reemplaza).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        product_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'product_ids'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      if (!Array.isArray(args.product_ids)) return err('product_ids debe ser array');
      const res = await api.put(`/ecommerce/discount-codes/${args.id}/products`, {
        productIds: args.product_ids,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Productos asignados');
    },
  },

  ecommerce_discount_codes_set_collections: {
    description:
      '[Ecommerce Discount Codes] Asignar colecciones al alcance del código (reemplaza).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        collection_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['id', 'collection_ids'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      if (!Array.isArray(args.collection_ids))
        return err('collection_ids debe ser array');
      const res = await api.put(
        `/ecommerce/discount-codes/${args.id}/collections`,
        { collectionIds: args.collection_ids },
      );
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Colecciones asignadas');
    },
  },
};
