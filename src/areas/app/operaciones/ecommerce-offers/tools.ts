import { api } from '../../../../services/api-client.js';

function err(message: string) {
  return { error: message };
}

function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

export const tools = {
  ecommerce_offers_list: {
    description: '[Ecommerce Offers] Listar ofertas (con filtro opcional por siteId).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string', description: 'UUID del sitio (opcional)' },
      },
    },
    handler: async (args: any) => {
      const qs = args.site_id ? `?siteId=${args.site_id}` : '';
      const res = await api.get(`/ecommerce/offers${qs}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ offers: res.data });
    },
  },

  ecommerce_offers_get: {
    description: '[Ecommerce Offers] Obtener una oferta por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID de la oferta' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.get(`/ecommerce/offers/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ offer: res.data });
    },
  },

  ecommerce_offers_create: {
    description: '[Ecommerce Offers] Crear una oferta/promoción.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string', description: 'UUID del sitio' },
        name: { type: 'string', description: 'Nombre de la oferta' },
        description: { type: 'string' },
        offer_type: {
          type: 'string',
          description: 'flash_sale | seasonal | clearance | general | free_shipping',
        },
        min_subtotal: { type: 'number', description: 'Subtotal mínimo para que aplique (ej: 80000). NULL = sin mínimo' },
        discount_type: { type: 'string', description: 'percentage | fixed' },
        discount_value: { type: 'number' },
        applies_to: {
          type: 'string',
          description:
            'all_products | specific_products | specific_collections',
        },
        start_date: { type: 'string', description: 'ISO date' },
        end_date: { type: 'string', description: 'ISO date' },
        priority: { type: 'number' },
        is_active: { type: 'boolean' },
      },
      required: ['name', 'offer_type', 'discount_type', 'discount_value', 'start_date', 'end_date'],
    },
    handler: async (args: any) => {
      const body: any = {
        name: args.name,
        offerType: args.offer_type,
        discountType: args.discount_type,
        discountValue: args.discount_value,
        startDate: args.start_date,
        endDate: args.end_date,
      };
      if (args.site_id) body.siteId = args.site_id;
      if (args.description) body.description = args.description;
      if (args.applies_to) body.appliesTo = args.applies_to;
      if (args.min_subtotal !== undefined) body.minSubtotal = args.min_subtotal;
      if (args.priority !== undefined) body.priority = args.priority;
      if (args.is_active !== undefined) body.isActive = args.is_active;
      const res = await api.post('/ecommerce/offers', body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ offer: res.data }, 'Oferta creada');
    },
  },

  ecommerce_offers_update: {
    description: '[Ecommerce Offers] Actualizar una oferta existente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        description: { type: 'string' },
        discount_value: { type: 'number' },
        min_subtotal: { type: 'number', description: 'Subtotal mínimo. NULL = sin mínimo' },
        start_date: { type: 'string' },
        end_date: { type: 'string' },
        priority: { type: 'number' },
        is_active: { type: 'boolean' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const { id, ...rest } = args;
      const body: any = {};
      if (rest.name !== undefined) body.name = rest.name;
      if (rest.description !== undefined) body.description = rest.description;
      if (rest.discount_value !== undefined) body.discountValue = rest.discount_value;
      if (rest.min_subtotal !== undefined) body.minSubtotal = rest.min_subtotal;
      if (rest.start_date !== undefined) body.startDate = rest.start_date;
      if (rest.end_date !== undefined) body.endDate = rest.end_date;
      if (rest.priority !== undefined) body.priority = rest.priority;
      if (rest.is_active !== undefined) body.isActive = rest.is_active;
      const res = await api.put(`/ecommerce/offers/${id}`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ offer: res.data }, 'Oferta actualizada');
    },
  },

  ecommerce_offers_delete: {
    description: '[Ecommerce Offers] Eliminar una oferta.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.del(`/ecommerce/offers/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Oferta eliminada');
    },
  },

  ecommerce_offers_set_products: {
    description:
      '[Ecommerce Offers] Asignar productos a una oferta (reemplaza la lista anterior).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        product_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'UUIDs de productos ecommerce',
        },
      },
      required: ['id', 'product_ids'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      if (!Array.isArray(args.product_ids)) return err('product_ids debe ser array');
      const res = await api.put(`/ecommerce/offers/${args.id}/products`, {
        productIds: args.product_ids,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Productos asignados');
    },
  },

  ecommerce_offers_set_collections: {
    description:
      '[Ecommerce Offers] Asignar colecciones a una oferta (reemplaza la lista anterior).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
        collection_ids: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      required: ['id', 'collection_ids'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      if (!Array.isArray(args.collection_ids))
        return err('collection_ids debe ser array');
      const res = await api.put(`/ecommerce/offers/${args.id}/collections`, {
        collectionIds: args.collection_ids,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Colecciones asignadas');
    },
  },
};
