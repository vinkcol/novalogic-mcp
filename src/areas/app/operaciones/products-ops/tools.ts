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
    description: '[Products Ops] Obtener detalle de un producto por ID, incluyendo variantes y componentes de kit.',
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
    description: '[Products Ops] Crear nuevo producto. Soporta 3 tipos: unit (simple), variant (con variantes de color/talla/etc), kit (compuesto por otros productos). Para kits, pasar kit_components con los IDs de productos componentes y cantidad.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre del producto' },
        sku: { type: 'string', description: 'SKU unico' },
        price: { type: 'number', description: 'Precio de venta' },
        cost: { type: 'number', description: 'Costo (opcional)' },
        category_id: { type: 'string', description: 'UUID de categoria' },
        description: { type: 'string', description: 'Descripcion' },
        product_type: { type: 'string', enum: ['unit', 'variant', 'kit'], description: 'Tipo de producto (default: unit)' },
        kit_components: {
          type: 'array',
          description: 'Componentes del kit (solo para product_type=kit). Cada componente referencia un producto existente.',
          items: {
            type: 'object',
            properties: {
              component_product_id: { type: 'string', description: 'UUID del producto componente' },
              quantity: { type: 'number', description: 'Cantidad de este componente en el kit' },
            },
            required: ['component_product_id', 'quantity'],
          },
        },
        variants: {
          type: 'array',
          description: 'Variantes del producto (solo para product_type=variant). Cada variante tiene nombre, SKU opcional, precio opcional y atributos.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nombre de la variante (ej: "Rojo", "Talla M")' },
              sku: { type: 'string', description: 'SKU de la variante (opcional)' },
              price: { type: 'number', description: 'Precio override (opcional, hereda del padre)' },
              cost: { type: 'number', description: 'Costo de la variante (opcional)' },
              attributes: { type: 'object', description: 'Atributos key-value (ej: {"color": "rojo", "talla": "M"})' },
            },
            required: ['name'],
          },
        },
        sale_rules: {
          type: 'object',
          description: 'Reglas de venta (opcional). Cantidad min/max y si permite fraccionario.',
          properties: {
            min_quantity: { type: 'number', description: 'Cantidad minima de venta' },
            max_quantity: { type: 'number', description: 'Cantidad maxima de venta (opcional)' },
            allow_fractional: { type: 'boolean', description: 'Permitir cantidades fraccionarias (default: false)' },
          },
          required: ['min_quantity'],
        },
      },
      required: ['name', 'price'],
    },
    handler: async (args: any) => {
      const body: any = {
        name: args.name,
        price: args.price,
      };
      if (args.sku) body.sku = args.sku;
      if (args.cost !== undefined) body.cost = args.cost;
      if (args.category_id) body.categoryId = args.category_id;
      if (args.description) body.description = args.description;
      if (args.product_type) body.productType = args.product_type;

      if (args.kit_components) {
        body.kitComponents = args.kit_components.map((c: any) => ({
          componentProductId: c.component_product_id,
          quantity: c.quantity,
        }));
      }

      if (args.variants) {
        body.variants = args.variants.map((v: any) => ({
          name: v.name,
          sku: v.sku,
          price: v.price,
          cost: v.cost,
          attributes: v.attributes,
        }));
      }

      if (args.sale_rules) {
        body.saleRules = {
          minQuantity: args.sale_rules.min_quantity,
          maxQuantity: args.sale_rules.max_quantity,
          allowFractional: args.sale_rules.allow_fractional,
        };
      }

      const res = await api.post('/products', body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ product: res.data }, 'Producto creado');
    },
  },

  products_ops_update: {
    description: '[Products Ops] Actualizar un producto. Soporta cambio de tipo, reemplazo de variantes y componentes de kit.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
        name: { type: 'string', description: 'Nuevo nombre' },
        price: { type: 'number', description: 'Nuevo precio' },
        cost: { type: 'number', description: 'Nuevo costo' },
        description: { type: 'string', description: 'Nueva descripcion' },
        category_id: { type: 'string', description: 'UUID de nueva categoria' },
        product_type: { type: 'string', enum: ['unit', 'variant', 'kit'], description: 'Cambiar tipo de producto' },
        kit_components: {
          type: 'array',
          description: 'Reemplazar componentes del kit (borra los anteriores y crea los nuevos)',
          items: {
            type: 'object',
            properties: {
              component_product_id: { type: 'string', description: 'UUID del producto componente' },
              quantity: { type: 'number', description: 'Cantidad' },
            },
            required: ['component_product_id', 'quantity'],
          },
        },
        variants: {
          type: 'array',
          description: 'Reemplazar variantes (borra las anteriores y crea las nuevas)',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Nombre de la variante' },
              sku: { type: 'string', description: 'SKU (opcional)' },
              price: { type: 'number', description: 'Precio override (opcional)' },
              cost: { type: 'number', description: 'Costo (opcional)' },
              attributes: { type: 'object', description: 'Atributos key-value' },
            },
            required: ['name'],
          },
        },
        sale_rules: {
          type: 'object',
          description: 'Reglas de venta',
          properties: {
            min_quantity: { type: 'number' },
            max_quantity: { type: 'number' },
            allow_fractional: { type: 'boolean' },
          },
        },
      },
      required: ['product_id'],
    },
    handler: async (args: any) => {
      const { product_id, ...rest } = args;
      const body: any = {};

      if (rest.name !== undefined) body.name = rest.name;
      if (rest.price !== undefined) body.price = rest.price;
      if (rest.cost !== undefined) body.cost = rest.cost;
      if (rest.description !== undefined) body.description = rest.description;
      if (rest.category_id !== undefined) body.categoryId = rest.category_id;
      if (rest.product_type !== undefined) body.productType = rest.product_type;

      if (rest.kit_components !== undefined) {
        body.kitComponents = rest.kit_components
          ? rest.kit_components.map((c: any) => ({
              componentProductId: c.component_product_id,
              quantity: c.quantity,
            }))
          : null;
      }

      if (rest.variants !== undefined) {
        body.variants = rest.variants
          ? rest.variants.map((v: any) => ({
              name: v.name,
              sku: v.sku,
              price: v.price,
              cost: v.cost,
              attributes: v.attributes,
            }))
          : null;
      }

      if (rest.sale_rules !== undefined) {
        body.saleRules = rest.sale_rules
          ? {
              minQuantity: rest.sale_rules.min_quantity,
              maxQuantity: rest.sale_rules.max_quantity,
              allowFractional: rest.sale_rules.allow_fractional,
            }
          : null;
      }

      const res = await api.put(`/products/${product_id}`, body);
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
    description: '[Products Ops] Registrar nuevo precio para un producto. Crea una version en el historial de precios y actualiza el precio actual. Permite rastrear cambios de precio con fecha efectiva y motivo.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        product_id: { type: 'string', description: 'UUID del producto' },
        price: { type: 'number', description: 'Nuevo precio de venta (COP)' },
        cost: { type: 'number', description: 'Costo del producto (opcional)' },
        reason: { type: 'string', description: 'Motivo del cambio de precio (ej: "ajuste inflacion", "campana Facebook")' },
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
    description: '[Products Ops] Obtener el precio vigente de un producto (ultima version activa).',
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
    description: '[Products Ops] Consultar el precio de un producto en una fecha especifica. Util para auditoria y calculo de margenes historicos.',
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
