import { api } from '../../../services/api-client.js';
import {
  createShopifyClient,
  getEnvShopifyClient,
} from '../../../services/shopify-client.js';
import {
  searchMemoryByText,
  storeMemory,
  updateMemory,
} from '../../../memory/vector-store.js';

type AnyRecord = Record<string, any>;

interface ShopifyRuntimeContext {
  source: 'internal-api' | 'env';
  companyId?: string;
  siteId?: string;
  shopDomain: string;
  apiVersion: string;
  authMode: string;
}

const contextProperties = {
  site_id: {
    type: 'string',
    description:
      'UUID del ecommerce site vinculado a la tienda Shopify. Recomendado en multi-tenant.',
  },
  company_id: {
    type: 'string',
    description:
      'UUID esperado de la empresa. Se valida contra el tenant resuelto por la Internal API.',
  },
};

function err(message: string, details?: unknown) {
  return details === undefined ? { error: message } : { error: message, details };
}

function ok(data: AnyRecord, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

function withContextSchema(
  properties: Record<string, unknown>,
  required: string[] = [],
) {
  return {
    type: 'object' as const,
    properties: {
      ...contextProperties,
      ...properties,
    },
    required,
  };
}

function normalizeOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function buildContextSummary(context: ShopifyRuntimeContext) {
  return {
    source: context.source,
    company_id: context.companyId,
    site_id: context.siteId,
    shop_domain: context.shopDomain,
    api_version: context.apiVersion,
    auth_mode: context.authMode,
  };
}

function validateRequestedCompany(
  requestedCompanyId: string | undefined,
  resolvedCompanyId?: string,
) {
  if (requestedCompanyId && resolvedCompanyId && requestedCompanyId !== resolvedCompanyId) {
    throw new Error(
      `company_id ${requestedCompanyId} no coincide con la configuracion resuelta (${resolvedCompanyId})`,
    );
  }
}

async function resolveShopify(args: AnyRecord) {
  const siteId = normalizeOptionalString(args.site_id);
  const companyId = normalizeOptionalString(args.company_id);

  if (siteId) {
    const res = await api.get(`/integrations/shopify/site/${siteId}/resolve`);
    if (!res.ok) {
      return err(
        `No se pudo resolver la configuracion Shopify para site_id ${siteId}: ${JSON.stringify(res.data)}`,
      );
    }

    validateRequestedCompany(companyId, res.data.companyId);

    const context: ShopifyRuntimeContext = {
      source: 'internal-api',
      companyId: res.data.companyId,
      siteId: res.data.siteId || siteId,
      shopDomain: res.data.shopDomain,
      apiVersion: res.data.apiVersion,
      authMode: res.data.authMode || 'bring_your_own_token',
    };

    return {
      client: createShopifyClient({
        shopDomain: res.data.shopDomain,
        apiVersion: res.data.apiVersion,
        accessToken: res.data.accessToken,
        clientId: res.data.clientId,
        clientSecret: res.data.clientSecret,
      }),
      context,
    };
  }

  const res = await api.get('/integrations/shopify/resolve');
  if (res.ok) {
    validateRequestedCompany(companyId, res.data.companyId);

    const context: ShopifyRuntimeContext = {
      source: 'internal-api',
      companyId: res.data.companyId,
      siteId: res.data.siteId,
      shopDomain: res.data.shopDomain,
      apiVersion: res.data.apiVersion,
      authMode: res.data.authMode || 'bring_your_own_token',
    };

    return {
      client: createShopifyClient({
        shopDomain: res.data.shopDomain,
        apiVersion: res.data.apiVersion,
        accessToken: res.data.accessToken,
        clientId: res.data.clientId,
        clientSecret: res.data.clientSecret,
      }),
      context,
    };
  }

  const envClient = getEnvShopifyClient();
  if (!envClient) {
    return err(
      'No se pudo resolver la configuracion Shopify. Provee site_id o configura una integracion activa accesible por Internal API.',
      res.data,
    );
  }

  if (companyId) {
    return err(
      'company_id no puede validarse contra el fallback de entorno. Usa site_id o una integracion resuelta por Internal API.',
    );
  }

  return {
    client: envClient,
    context: {
      source: 'env' as const,
      shopDomain: envClient.config.shopDomain,
      apiVersion: envClient.config.apiVersion,
      authMode: envClient.config.hasDirectAccessToken
        ? 'env_access_token'
        : 'dev_dashboard_client_credentials',
    },
  };
}

async function runShopify(
  args: AnyRecord,
  handler: (
    client: ReturnType<typeof createShopifyClient>,
    context: ShopifyRuntimeContext,
  ) => Promise<AnyRecord>,
) {
  const resolved = await resolveShopify(args);
  if ('error' in resolved) return resolved;

  const result = await handler(resolved.client, resolved.context);
  if ('error' in result) return result;

  return ok({
    ...result,
    shopify_context: buildContextSummary(resolved.context),
  });
}

async function upsertShopifySiteMemory(entry: {
  siteId: string;
  companyId?: string;
  siteName: string;
  siteType?: string;
  siteStatus?: string;
  websiteUrl?: string;
  shopDomain?: string;
  authMode?: string;
  apiVersion?: string;
  hasShopifyConfig: boolean;
}) {
  const title = `Shopify Site Inventory: ${entry.siteId}`;
  const content = [
    `site_id: ${entry.siteId}`,
    `company_id: ${entry.companyId || 'unknown'}`,
    `site_name: ${entry.siteName}`,
    `site_type: ${entry.siteType || 'unknown'}`,
    `site_status: ${entry.siteStatus || 'unknown'}`,
    `website_url: ${entry.websiteUrl || 'n/a'}`,
    `shop_domain: ${entry.shopDomain || 'n/a'}`,
    `auth_mode: ${entry.authMode || 'n/a'}`,
    `api_version: ${entry.apiVersion || 'n/a'}`,
    `has_shopify_config: ${entry.hasShopifyConfig ? 'true' : 'false'}`,
  ].join('\n');

  const metadata = {
    source: 'shopify-sites-inventory',
    site_id: entry.siteId,
    company_id: entry.companyId,
    site_name: entry.siteName,
    site_type: entry.siteType,
    site_status: entry.siteStatus,
    website_url: entry.websiteUrl,
    shop_domain: entry.shopDomain,
    auth_mode: entry.authMode,
    api_version: entry.apiVersion,
    has_shopify_config: entry.hasShopifyConfig,
    secret_free: true,
  };

  const existing = await searchMemoryByText(title, {
    category: 'config',
    limit: 10,
  });
  const exact = existing.find((item) => item.title === title);

  if (exact) {
    await updateMemory(exact.id, {
      title,
      content,
      metadata,
      tags: ['shopify', 'site-inventory', entry.siteId],
    });
    return { action: 'updated', memory_id: exact.id };
  }

  const id = await storeMemory({
    agent: 'librarian',
    category: 'config',
    title,
    content,
    metadata,
    tags: ['shopify', 'site-inventory', entry.siteId],
  });
  return { action: 'created', memory_id: id };
}

export const tools = {
  shopify_sites_inventory: {
    description:
      '[Shopify] Inventariar sitios ecommerce del tenant, resolver cuales tienen configuracion Shopify aislada y opcionalmente sincronizar un resumen no sensible al motor de memoria.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sync_memory: {
          type: 'boolean',
          description:
            'Si true, guarda o actualiza una memoria resumida no sensible por sitio (default: true).',
        },
        include_unlinked: {
          type: 'boolean',
          description:
            'Si true, incluye sitios sin configuracion Shopify resuelta (default: true).',
        },
      },
    },
    handler: async (args: AnyRecord) => {
      const syncMemory = args.sync_memory !== false;
      const includeUnlinked = args.include_unlinked !== false;

      const sitesRes = await api.get('/ecommerce-sites');
      if (!sitesRes.ok) {
        return err(`No se pudo listar ecommerce sites: ${JSON.stringify(sitesRes.data)}`);
      }

      const sites = Array.isArray(sitesRes.data) ? sitesRes.data : [];
      const inventory: AnyRecord[] = [];
      const memorySync: AnyRecord[] = [];

      for (const site of sites) {
        const resolveRes = await api.get(`/integrations/shopify/site/${site.id}/resolve`);
        const hasShopifyConfig = resolveRes.ok;

        if (!hasShopifyConfig && !includeUnlinked) {
          continue;
        }

        const item = {
          site_id: site.id,
          company_id: resolveRes.ok ? resolveRes.data.companyId : undefined,
          site_name: site.name,
          site_type: site.type,
          connection_status: site.connectionStatus,
          is_active: site.isActive,
          website_url: site.websiteUrl,
          has_shopify_config: hasShopifyConfig,
          shop_domain: resolveRes.ok ? resolveRes.data.shopDomain : undefined,
          auth_mode: resolveRes.ok ? resolveRes.data.authMode : undefined,
          api_version: resolveRes.ok ? resolveRes.data.apiVersion : undefined,
          resolution_error: resolveRes.ok ? undefined : resolveRes.data,
        };
        inventory.push(item);

        if (syncMemory) {
          const memoryResult = await upsertShopifySiteMemory({
            siteId: site.id,
            companyId: item.company_id,
            siteName: site.name,
            siteType: site.type,
            siteStatus: site.connectionStatus,
            websiteUrl: site.websiteUrl,
            shopDomain: item.shop_domain,
            authMode: item.auth_mode,
            apiVersion: item.api_version,
            hasShopifyConfig,
          });
          memorySync.push({
            site_id: site.id,
            ...memoryResult,
          });
        }
      }

      return ok({
        sites: inventory,
        count: inventory.length,
        linked_count: inventory.filter((item) => item.has_shopify_config).length,
        unlinked_count: inventory.filter((item) => !item.has_shopify_config).length,
        memory_sync: memorySync,
      });
    },
  },

  shopify_products_list: {
    description:
      '[Shopify] Listar productos de la tienda. Soporta paginacion, filtros y contexto multi-tenant por site_id.',
    inputSchema: withContextSchema({
      limit: { type: 'number', description: 'Cantidad de productos (max 250, default 50)' },
      page_info: {
        type: 'string',
        description: 'Cursor de paginacion (del header Link de la respuesta anterior)',
      },
      status: {
        type: 'string',
        enum: ['active', 'draft', 'archived'],
        description: 'Filtrar por estado',
      },
      collection_id: { type: 'string', description: 'Filtrar por coleccion' },
      title: { type: 'string', description: 'Filtrar por titulo (busqueda parcial)' },
    }),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const params = new URLSearchParams();
        params.set('limit', String(args.limit || 50));
        if (args.status) params.set('status', args.status);
        if (args.collection_id) params.set('collection_id', args.collection_id);
        if (args.title) params.set('title', args.title);

        const path = args.page_info
          ? `/products.json?page_info=${args.page_info}&limit=${args.limit || 50}`
          : `/products.json?${params.toString()}`;

        const res = await client.get(path);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { products: res.data.products, count: res.data.products?.length ?? 0 };
      }),
  },

  shopify_products_get: {
    description: '[Shopify] Obtener un producto por ID con todas sus variantes e imagenes.',
    inputSchema: withContextSchema(
      {
        id: { type: 'string', description: 'ID numerico del producto en Shopify' },
      },
      ['id'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.get(`/products/${args.id}.json`);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { product: res.data.product };
      }),
  },

  shopify_products_create: {
    description: '[Shopify] Crear un producto nuevo en la tienda.',
    inputSchema: withContextSchema(
      {
        title: { type: 'string', description: 'Nombre del producto' },
        body_html: { type: 'string', description: 'Descripcion HTML del producto' },
        vendor: { type: 'string', description: 'Proveedor o marca' },
        product_type: { type: 'string', description: 'Tipo de producto' },
        tags: { type: 'string', description: 'Tags separados por coma' },
        status: {
          type: 'string',
          enum: ['active', 'draft', 'archived'],
          description: 'Estado (default: draft)',
        },
        variants: {
          type: 'array',
          description:
            'Array de variantes: [{ price, sku, inventory_quantity, option1, option2, option3 }]',
          items: { type: 'object' },
        },
        images: {
          type: 'array',
          description: 'Array de imagenes: [{ src: "url" }]',
          items: { type: 'object' },
        },
      },
      ['title'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const product: AnyRecord = { title: args.title };
        if (args.body_html) product.body_html = args.body_html;
        if (args.vendor) product.vendor = args.vendor;
        if (args.product_type) product.product_type = args.product_type;
        if (args.tags) product.tags = args.tags;
        if (args.status) product.status = args.status;
        if (args.variants) product.variants = args.variants;
        if (args.images) product.images = args.images;

        const res = await client.post('/products.json', { product });
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return {
          product: res.data.product,
          message: 'Producto creado en Shopify',
        };
      }),
  },

  shopify_products_update: {
    description: '[Shopify] Actualizar un producto existente (titulo, descripcion, tags, estado, etc.).',
    inputSchema: withContextSchema(
      {
        id: { type: 'string', description: 'ID del producto' },
        title: { type: 'string', description: 'Nuevo titulo' },
        body_html: { type: 'string', description: 'Nueva descripcion HTML' },
        vendor: { type: 'string', description: 'Nuevo vendor' },
        product_type: { type: 'string', description: 'Nuevo tipo' },
        tags: { type: 'string', description: 'Nuevos tags (separados por coma)' },
        status: {
          type: 'string',
          enum: ['active', 'draft', 'archived'],
          description: 'Nuevo estado',
        },
      },
      ['id'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const product: AnyRecord = { id: Number(args.id) };
        if (args.title !== undefined) product.title = args.title;
        if (args.body_html !== undefined) product.body_html = args.body_html;
        if (args.vendor !== undefined) product.vendor = args.vendor;
        if (args.product_type !== undefined) product.product_type = args.product_type;
        if (args.tags !== undefined) product.tags = args.tags;
        if (args.status !== undefined) product.status = args.status;

        const res = await client.put(`/products/${args.id}.json`, { product });
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return {
          product: res.data.product,
          message: 'Producto actualizado en Shopify',
        };
      }),
  },

  shopify_products_delete: {
    description: '[Shopify] Eliminar un producto de Shopify (irreversible).',
    inputSchema: withContextSchema(
      {
        id: { type: 'string', description: 'ID del producto a eliminar' },
      },
      ['id'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.del(`/products/${args.id}.json`);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { deleted: true, message: 'Producto eliminado de Shopify' };
      }),
  },

  shopify_orders_list: {
    description: '[Shopify] Listar ordenes con filtros por estado, fecha y fulfillment.',
    inputSchema: withContextSchema({
      limit: { type: 'number', description: 'Cantidad (max 250, default 50)' },
      status: {
        type: 'string',
        enum: ['open', 'closed', 'cancelled', 'any'],
        description: 'Estado (default: any)',
      },
      financial_status: {
        type: 'string',
        enum: ['authorized', 'pending', 'paid', 'partially_paid', 'refunded', 'voided', 'any'],
        description: 'Estado financiero',
      },
      fulfillment_status: {
        type: 'string',
        enum: ['shipped', 'partial', 'unshipped', 'unfulfilled', 'any'],
        description: 'Estado de fulfillment',
      },
      created_at_min: { type: 'string', description: 'Fecha minima ISO 8601' },
      created_at_max: { type: 'string', description: 'Fecha maxima ISO 8601' },
      page_info: { type: 'string', description: 'Cursor de paginacion' },
    }),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        if (args.page_info) {
          const res = await client.get(
            `/orders.json?page_info=${args.page_info}&limit=${args.limit || 50}`,
          );
          if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
          return { orders: res.data.orders, count: res.data.orders?.length ?? 0 };
        }

        const params = new URLSearchParams();
        params.set('limit', String(args.limit || 50));
        params.set('status', args.status || 'any');
        if (args.financial_status) params.set('financial_status', args.financial_status);
        if (args.fulfillment_status) params.set('fulfillment_status', args.fulfillment_status);
        if (args.created_at_min) params.set('created_at_min', args.created_at_min);
        if (args.created_at_max) params.set('created_at_max', args.created_at_max);

        const res = await client.get(`/orders.json?${params.toString()}`);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { orders: res.data.orders, count: res.data.orders?.length ?? 0 };
      }),
  },

  shopify_orders_get: {
    description: '[Shopify] Obtener detalle de una orden por ID (line items, pagos, envio, cliente).',
    inputSchema: withContextSchema(
      {
        id: { type: 'string', description: 'ID de la orden' },
      },
      ['id'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.get(`/orders/${args.id}.json`);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { order: res.data.order };
      }),
  },

  shopify_orders_count: {
    description: '[Shopify] Contar ordenes con filtros opcionales.',
    inputSchema: withContextSchema({
      status: {
        type: 'string',
        enum: ['open', 'closed', 'cancelled', 'any'],
        description: 'Estado',
      },
      financial_status: { type: 'string', description: 'Estado financiero' },
      fulfillment_status: { type: 'string', description: 'Estado de fulfillment' },
      created_at_min: { type: 'string', description: 'Fecha minima ISO 8601' },
      created_at_max: { type: 'string', description: 'Fecha maxima ISO 8601' },
    }),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const params = new URLSearchParams();
        if (args.status) params.set('status', args.status);
        if (args.financial_status) params.set('financial_status', args.financial_status);
        if (args.fulfillment_status) params.set('fulfillment_status', args.fulfillment_status);
        if (args.created_at_min) params.set('created_at_min', args.created_at_min);
        if (args.created_at_max) params.set('created_at_max', args.created_at_max);

        const res = await client.get(`/orders/count.json?${params.toString()}`);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { count: res.data.count };
      }),
  },

  shopify_customers_list: {
    description: '[Shopify] Listar clientes de la tienda.',
    inputSchema: withContextSchema({
      limit: { type: 'number', description: 'Cantidad (max 250, default 50)' },
      page_info: { type: 'string', description: 'Cursor de paginacion' },
    }),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const path = args.page_info
          ? `/customers.json?page_info=${args.page_info}&limit=${args.limit || 50}`
          : `/customers.json?limit=${args.limit || 50}`;

        const res = await client.get(path);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { customers: res.data.customers, count: res.data.customers?.length ?? 0 };
      }),
  },

  shopify_customers_get: {
    description: '[Shopify] Obtener detalle de un cliente por ID.',
    inputSchema: withContextSchema(
      {
        id: { type: 'string', description: 'ID del cliente' },
      },
      ['id'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.get(`/customers/${args.id}.json`);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { customer: res.data.customer };
      }),
  },

  shopify_customers_search: {
    description: '[Shopify] Buscar clientes por email, nombre o telefono.',
    inputSchema: withContextSchema(
      {
        query: { type: 'string', description: 'Busqueda: email, nombre o telefono' },
      },
      ['query'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.get(
          `/customers/search.json?query=${encodeURIComponent(args.query)}`,
        );
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { customers: res.data.customers, count: res.data.customers?.length ?? 0 };
      }),
  },

  shopify_inventory_levels: {
    description: '[Shopify] Ver niveles de inventario por location o item.',
    inputSchema: withContextSchema({
      location_ids: { type: 'string', description: 'IDs de locations separados por coma' },
      inventory_item_ids: {
        type: 'string',
        description: 'IDs de inventory items separados por coma',
      },
    }),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const params = new URLSearchParams();
        if (args.location_ids) params.set('location_ids', args.location_ids);
        if (args.inventory_item_ids) {
          params.set('inventory_item_ids', args.inventory_item_ids);
        }

        if (!args.location_ids && !args.inventory_item_ids) {
          return err('Se requiere al menos location_ids o inventory_item_ids');
        }

        const res = await client.get(`/inventory_levels.json?${params.toString()}`);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { inventory_levels: res.data.inventory_levels };
      }),
  },

  shopify_inventory_adjust: {
    description:
      '[Shopify] Ajustar nivel de inventario de un item en una location (sumar o restar).',
    inputSchema: withContextSchema(
      {
        inventory_item_id: { type: 'number', description: 'ID del inventory item' },
        location_id: { type: 'number', description: 'ID de la location' },
        available_adjustment: {
          type: 'number',
          description: 'Cantidad a ajustar (+/- para sumar/restar)',
        },
      },
      ['inventory_item_id', 'location_id', 'available_adjustment'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.post('/inventory_levels/adjust.json', {
          inventory_item_id: args.inventory_item_id,
          location_id: args.location_id,
          available_adjustment: args.available_adjustment,
        });
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return {
          inventory_level: res.data.inventory_level,
          message: 'Inventario ajustado',
        };
      }),
  },

  shopify_locations_list: {
    description: '[Shopify] Listar locations (bodegas o tiendas) de la tienda.',
    inputSchema: withContextSchema({}),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.get('/locations.json');
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { locations: res.data.locations };
      }),
  },

  shopify_collections_list: {
    description: '[Shopify] Listar colecciones manuales (custom collections).',
    inputSchema: withContextSchema({
      limit: { type: 'number', description: 'Cantidad (default 50)' },
    }),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.get(`/custom_collections.json?limit=${args.limit || 50}`);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { collections: res.data.custom_collections };
      }),
  },

  shopify_collections_get: {
    description: '[Shopify] Obtener detalle de una coleccion y sus productos.',
    inputSchema: withContextSchema(
      {
        id: { type: 'string', description: 'ID de la coleccion' },
      },
      ['id'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const [collectionRes, productsRes] = await Promise.all([
          client.get(`/custom_collections/${args.id}.json`),
          client.get(`/products.json?collection_id=${args.id}&limit=250`),
        ]);

        if (!collectionRes.ok) {
          return err(`Error ${collectionRes.status}: ${JSON.stringify(collectionRes.data)}`);
        }

        return {
          collection: collectionRes.data.custom_collection,
          products: productsRes.ok ? productsRes.data.products : [],
        };
      }),
  },

  shopify_fulfillments_list: {
    description: '[Shopify] Listar fulfillments de una orden.',
    inputSchema: withContextSchema(
      {
        order_id: { type: 'string', description: 'ID de la orden' },
      },
      ['order_id'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.get(`/orders/${args.order_id}/fulfillments.json`);
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { fulfillments: res.data.fulfillments };
      }),
  },

  shopify_fulfillments_create: {
    description:
      '[Shopify] Crear fulfillment para una orden (marcar como enviado con tracking).',
    inputSchema: withContextSchema(
      {
        order_id: { type: 'string', description: 'ID de la orden' },
        tracking_number: { type: 'string', description: 'Numero de rastreo' },
        tracking_company: {
          type: 'string',
          description: 'Empresa de envio (ej: Servientrega, DHL)',
        },
        tracking_url: { type: 'string', description: 'URL de rastreo' },
        notify_customer: {
          type: 'boolean',
          description: 'Notificar al cliente (default: true)',
        },
        line_items: {
          type: 'array',
          description:
            'Items especificos a fulfillmentar: [{ id, quantity }]. Si no se envia, se fulfillmentea todo.',
          items: { type: 'object' },
        },
      },
      ['order_id'],
    ),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const fulfillment: AnyRecord = {
          notify_customer: args.notify_customer !== false,
        };
        if (args.tracking_number) fulfillment.tracking_number = args.tracking_number;
        if (args.tracking_company) fulfillment.tracking_company = args.tracking_company;
        if (args.tracking_url) fulfillment.tracking_url = args.tracking_url;
        if (args.line_items) fulfillment.line_items = args.line_items;

        const res = await client.post(
          `/orders/${args.order_id}/fulfillments.json`,
          { fulfillment },
        );
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return {
          fulfillment: res.data.fulfillment,
          message: 'Fulfillment creado',
        };
      }),
  },

  shopify_shop_info: {
    description: '[Shopify] Obtener informacion general de la tienda.',
    inputSchema: withContextSchema({}),
    handler: async (args: AnyRecord) =>
      runShopify(args, async (client) => {
        const res = await client.get('/shop.json');
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return { shop: res.data.shop };
      }),
  },
};
