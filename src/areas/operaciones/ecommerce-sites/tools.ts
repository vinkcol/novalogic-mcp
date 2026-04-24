import { api } from '../../../services/api-client.js';
import * as fs from 'fs';

function err(message: string) {
  return { error: message };
}

function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

export const tools = {
  ecommerce_sites_list: {
    description: '[Ecommerce Sites] Listar todos los sitios ecommerce de la empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/ecommerce-sites');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sites: res.data });
    },
  },

  ecommerce_sites_get: {
    description: '[Ecommerce Sites] Obtener un sitio ecommerce por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del sitio' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.get(`/ecommerce-sites/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ site: res.data });
    },
  },

  ecommerce_sites_stats: {
    description: '[Ecommerce Sites] Obtener estadísticas de un sitio (cantidad de productos, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del sitio' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.get(`/ecommerce-sites/${args.id}/stats`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ stats: res.data });
    },
  },

  ecommerce_sites_create: {
    description: '[Ecommerce Sites] Crear un nuevo sitio ecommerce. Tipos: CATALOG (próximamente) o INTEGRATION.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre del sitio (ej: "Mi Tienda Online")' },
        type: { type: 'string', enum: ['CATALOG', 'INTEGRATION'], description: 'Tipo de sitio' },
        website_url: { type: 'string', description: 'URL del sitio web (ej: https://mitienda.com)' },
        webhook_url: { type: 'string', description: 'URL para recibir webhooks' },
        webhook_secret: { type: 'string', description: 'Secreto para validar webhooks' },
      },
      required: ['name', 'type'],
    },
    handler: async (args: any) => {
      if (!args.name) return err('name es requerido');
      if (!args.type) return err('type es requerido');

      const res = await api.post('/ecommerce-sites', {
        name: args.name,
        type: args.type,
        websiteUrl: args.website_url,
        webhookUrl: args.webhook_url,
        webhookSecret: args.webhook_secret,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ site: res.data }, 'Sitio creado exitosamente');
    },
  },

  ecommerce_sites_update: {
    description: '[Ecommerce Sites] Actualizar un sitio ecommerce existente (nombre, URL, webhook, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del sitio a actualizar' },
        name: { type: 'string', description: 'Nuevo nombre del sitio' },
        website_url: { type: 'string', description: 'Nueva URL del sitio web' },
        webhook_url: { type: 'string', description: 'Nueva URL de webhook' },
        webhook_secret: { type: 'string', description: 'Nuevo secreto de webhook' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');

      const body: any = {};
      if (args.name !== undefined) body.name = args.name;
      if (args.website_url !== undefined) body.websiteUrl = args.website_url;
      if (args.webhook_url !== undefined) body.webhookUrl = args.webhook_url;
      if (args.webhook_secret !== undefined) body.webhookSecret = args.webhook_secret;

      const res = await api.put(`/ecommerce-sites/${args.id}`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ site: res.data }, 'Sitio actualizado exitosamente');
    },
  },

  ecommerce_sites_get_config: {
    description: '[Ecommerce Sites] Obtener la configuración completa de un sitio (branding, contacto, redes, apariencia, envío).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del sitio' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.get(`/ecommerce-sites/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ config: res.data });
    },
  },

  ecommerce_sites_update_config: {
    description: '[Ecommerce Sites] Actualizar configuración de un sitio: apariencia (colores, banner), contacto, redes sociales, envío, identidad (nombre, logo, descripción, slogan).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del sitio a actualizar' },
        description: { type: 'string', description: 'Descripción de la tienda' },
        logo_url: { type: 'string', description: 'URL del logo' },
        favicon_url: { type: 'string', description: 'URL del favicon' },
        slogan: { type: 'string', description: 'Slogan de la marca' },
        appearance: { type: 'object', description: 'JSON: { primaryColor, secondaryColor, accentColor, bannerUrl, bannerText, theme }' },
        contact: { type: 'object', description: 'JSON: { phone, whatsapp, email, address: { street, city, state, country } }' },
        social_links: { type: 'object', description: 'JSON: { instagram, facebook, tiktok, twitter, youtube, linkedin }' },
        business_hours: { type: 'object', description: 'JSON: horarios por día' },
        shipping_config: { type: 'object', description: 'JSON: { standardCost, freeShippingThreshold, estimatedDaysMin, estimatedDaysMax }' },
        currency: { type: 'string', description: 'Moneda (ej: COP)' },
        locale: { type: 'string', description: 'Locale (ej: es-CO)' },
        timezone: { type: 'string', description: 'Zona horaria (ej: America/Bogota)' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const body: any = {};
      if (args.description !== undefined) body.description = args.description;
      if (args.logo_url !== undefined) body.logoUrl = args.logo_url;
      if (args.favicon_url !== undefined) body.faviconUrl = args.favicon_url;
      if (args.slogan !== undefined) body.slogan = args.slogan;
      if (args.appearance !== undefined) body.appearance = args.appearance;
      if (args.contact !== undefined) body.contact = args.contact;
      if (args.social_links !== undefined) body.socialLinks = args.social_links;
      if (args.business_hours !== undefined) body.businessHours = args.business_hours;
      if (args.shipping_config !== undefined) body.shippingConfig = args.shipping_config;
      if (args.currency !== undefined) body.currency = args.currency;
      if (args.locale !== undefined) body.locale = args.locale;
      if (args.timezone !== undefined) body.timezone = args.timezone;

      const res = await api.put(`/ecommerce-sites/${args.id}`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ site: res.data }, 'Configuración actualizada exitosamente');
    },
  },

  ecommerce_sites_delete: {
    description: '[Ecommerce Sites] Eliminar un sitio ecommerce.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del sitio a eliminar' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.del(`/ecommerce-sites/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Sitio eliminado exitosamente');
    },
  },

  // ============================================
  // Ecommerce Products
  // ============================================

  ecommerce_sites_products_list: {
    description: '[Ecommerce Products] Listar productos ecommerce de la tienda. Opcionalmente filtrar por siteId.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string', description: 'UUID del sitio (opcional, filtra por sitio)' },
      },
    },
    handler: async (args: any) => {
      const query = args.site_id ? `?siteId=${args.site_id}` : '';
      const res = await api.get(`/ecommerce-products${query}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ products: res.data, count: Array.isArray(res.data) ? res.data.length : 0 });
    },
  },

  ecommerce_sites_products_get: {
    description: '[Ecommerce Products] Obtener un producto ecommerce por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del producto ecommerce' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.get(`/ecommerce-products/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ product: res.data });
    },
  },

  ecommerce_sites_products_create: {
    description: '[Ecommerce Products] Crear un producto ecommerce a partir de un item de inventario. Requiere inventoryItemId.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        inventory_item_id: { type: 'string', description: 'UUID del item de inventario' },
        title: { type: 'string', description: 'Nombre del producto para la tienda' },
        price: { type: 'number', description: 'Precio de venta' },
        category: { type: 'string', description: 'Categoría (ej: Esmaltes, Bases, Tratamientos)' },
        site_id: { type: 'string', description: 'UUID del sitio ecommerce' },
        is_published: { type: 'boolean', description: 'Publicar inmediatamente (default: true)' },
        description: { type: 'string', description: 'Descripción del producto' },
      },
      required: ['inventory_item_id', 'title', 'price'],
    },
    handler: async (args: any) => {
      if (!args.inventory_item_id) return err('inventory_item_id es requerido');
      if (!args.title) return err('title es requerido');

      const res = await api.post('/ecommerce-products', {
        inventoryItemId: args.inventory_item_id,
        title: args.title,
        price: args.price,
        category: args.category,
        siteId: args.site_id,
        isPublished: args.is_published ?? true,
        description: args.description,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ product: res.data }, 'Producto ecommerce creado');
    },
  },

  ecommerce_sites_products_bulk_create: {
    description: '[Ecommerce Products] Crear múltiples productos ecommerce a partir de items de inventario. Recibe un array de objetos con inventory_item_id, title, price, category.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string', description: 'UUID del sitio ecommerce (se aplica a todos)' },
        products: {
          type: 'array',
          description: 'Array de productos a crear',
          items: {
            type: 'object',
            properties: {
              inventory_item_id: { type: 'string', description: 'UUID del item de inventario' },
              title: { type: 'string', description: 'Nombre del producto' },
              price: { type: 'number', description: 'Precio de venta' },
              category: { type: 'string', description: 'Categoría' },
            },
            required: ['inventory_item_id', 'title', 'price'],
          },
        },
        is_published: { type: 'boolean', description: 'Publicar inmediatamente (default: true)' },
      },
      required: ['site_id', 'products'],
    },
    handler: async (args: any) => {
      if (!args.site_id) return err('site_id es requerido');
      if (!args.products || !Array.isArray(args.products) || args.products.length === 0) {
        return err('products es requerido (array no vacío)');
      }

      const results: any[] = [];
      let succeeded = 0;
      let failed = 0;

      for (const p of args.products) {
        const res = await api.post('/ecommerce-products', {
          inventoryItemId: p.inventory_item_id,
          title: p.title,
          price: p.price,
          category: p.category,
          siteId: args.site_id,
          isPublished: args.is_published ?? true,
        });
        if (res.ok) {
          succeeded++;
          results.push({ title: p.title, status: 'created', id: res.data?.id });
        } else {
          failed++;
          results.push({ title: p.title, status: 'error', error: res.data?.message || res.status });
        }
      }

      return ok({ results, succeeded, failed, total: args.products.length },
        `${succeeded} productos creados, ${failed} errores`);
    },
  },

  ecommerce_sites_products_update: {
    description: '[Ecommerce Products] Actualizar un producto ecommerce (descripción, precio, SEO, publicación, imágenes, etc.).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del producto ecommerce' },
        description: { type: 'string' },
        price: { type: 'number' },
        is_published: { type: 'boolean' },
        category: { type: 'string' },
        web_title: { type: 'string' },
        web_keywords: { type: 'string' },
        images: { type: 'array', items: { type: 'string' }, description: 'Array de URLs de imágenes del producto' },
        tags: { type: 'array', items: { type: 'string' }, description: 'Tags del producto' },
        compare_at_price: { type: 'number', description: 'Precio de comparación (precio anterior tachado)' },
        is_featured: { type: 'boolean', description: 'Destacar producto' },
        short_description: { type: 'string', description: 'Descripción corta (máx 500 chars)' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const body: any = {};
      if (args.description !== undefined) body.description = args.description;
      if (args.price !== undefined) body.price = args.price;
      if (args.is_published !== undefined) body.isPublished = args.is_published;
      if (args.category !== undefined) body.category = args.category;
      if (args.web_title !== undefined) body.webTitle = args.web_title;
      if (args.web_keywords !== undefined) body.webKeywords = args.web_keywords;
      if (args.images !== undefined) body.images = args.images;
      if (args.tags !== undefined) body.tags = args.tags;
      if (args.compare_at_price !== undefined) body.compareAtPrice = args.compare_at_price;
      if (args.is_featured !== undefined) body.isFeatured = args.is_featured;
      if (args.short_description !== undefined) body.shortDescription = args.short_description;

      const res = await api.put(`/ecommerce-products/${args.id}`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ product: res.data }, 'Producto actualizado');
    },
  },

  ecommerce_sites_products_upload_images: {
    description: '[Ecommerce Products] Subir imágenes locales a Cloudinary y vincularlas al producto. Lee archivos del sistema local, los sube al folder ecommerce/productos en Cloudinary y actualiza el array images del producto.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del producto ecommerce' },
        file_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Rutas absolutas de los archivos de imagen locales a subir',
        },
        replace: {
          type: 'boolean',
          description: 'true = reemplaza todas las imágenes existentes; false = agrega a las existentes (default: false)',
        },
      },
      required: ['id', 'file_paths'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      if (!args.file_paths || !Array.isArray(args.file_paths) || args.file_paths.length === 0) {
        return err('file_paths es requerido (array de rutas)');
      }

      const images: Array<{ base64: string; filename: string }> = [];
      for (const filePath of args.file_paths) {
        try {
          const buffer = fs.readFileSync(filePath);
          const filename = filePath.split(/[\\/]/).pop() || 'image.jpg';
          images.push({ base64: buffer.toString('base64'), filename });
        } catch (e: any) {
          return err(`No se pudo leer el archivo: ${filePath} — ${e.message}`);
        }
      }

      const res = await api.post(`/ecommerce-products/${args.id}/images`, {
        images,
        replace: args.replace ?? false,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(
        { product: res.data, uploaded: images.length, cloudinary_urls: res.data?.images ?? [] },
        `${images.length} imagen(es) subida(s) a Cloudinary y vinculadas al producto`,
      );
    },
  },

  ecommerce_sites_products_delete: {
    description: '[Ecommerce Products] Eliminar un producto ecommerce.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID del producto ecommerce' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.del(`/ecommerce-products/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Producto eliminado');
    },
  },

  // ============================================
  // Ecommerce Collections
  // ============================================

  ecommerce_sites_collections_list: {
    description: '[Ecommerce Collections] Listar colecciones de la tienda. Opcionalmente filtrar por siteId.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string', description: 'UUID del sitio (opcional)' },
      },
    },
    handler: async (args: any) => {
      const query = args.site_id ? `?siteId=${args.site_id}` : '';
      const res = await api.get(`/ecommerce-collections${query}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ collections: res.data, count: Array.isArray(res.data) ? res.data.length : 0 });
    },
  },

  ecommerce_sites_collections_get: {
    description: '[Ecommerce Collections] Obtener una colección por ID (incluye sus productos).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID de la colección' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.get(`/ecommerce-collections/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ collection: res.data });
    },
  },

  ecommerce_sites_collections_create: {
    description: '[Ecommerce Collections] Crear una colección de productos (ej: Más vendidos, Recomendados, Ofertas).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        site_id: { type: 'string', description: 'UUID del sitio ecommerce' },
        name: { type: 'string', description: 'Nombre de la colección' },
        description: { type: 'string', description: 'Descripción (opcional)' },
        image_url: { type: 'string', description: 'URL de imagen (opcional)' },
        is_published: { type: 'boolean', description: 'Publicar inmediatamente (default: true)' },
        sort_order: { type: 'number', description: 'Orden de display (default: 0)' },
      },
      required: ['site_id', 'name'],
    },
    handler: async (args: any) => {
      if (!args.site_id) return err('site_id es requerido');
      if (!args.name) return err('name es requerido');

      const res = await api.post('/ecommerce-collections', {
        siteId: args.site_id,
        name: args.name,
        description: args.description,
        imageUrl: args.image_url,
        isPublished: args.is_published ?? true,
        sortOrder: args.sort_order ?? 0,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ collection: res.data }, 'Colección creada');
    },
  },

  ecommerce_sites_collections_update: {
    description: '[Ecommerce Collections] Actualizar una colección existente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID de la colección' },
        name: { type: 'string' },
        description: { type: 'string' },
        image_url: { type: 'string' },
        is_published: { type: 'boolean' },
        sort_order: { type: 'number' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const body: any = {};
      if (args.name !== undefined) body.name = args.name;
      if (args.description !== undefined) body.description = args.description;
      if (args.image_url !== undefined) body.imageUrl = args.image_url;
      if (args.is_published !== undefined) body.isPublished = args.is_published;
      if (args.sort_order !== undefined) body.sortOrder = args.sort_order;

      const res = await api.put(`/ecommerce-collections/${args.id}`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ collection: res.data }, 'Colección actualizada');
    },
  },

  ecommerce_sites_collections_delete: {
    description: '[Ecommerce Collections] Eliminar una colección.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID de la colección a eliminar' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      const res = await api.del(`/ecommerce-collections/${args.id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Colección eliminada');
    },
  },

  ecommerce_sites_collections_set_products: {
    description: '[Ecommerce Collections] Asignar productos a una colección (reemplaza los existentes). El orden del array define la posición.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'UUID de la colección' },
        product_ids: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array de UUIDs de productos ecommerce (el orden importa)',
        },
      },
      required: ['id', 'product_ids'],
    },
    handler: async (args: any) => {
      if (!args.id) return err('id es requerido');
      if (!args.product_ids || !Array.isArray(args.product_ids)) {
        return err('product_ids es requerido (array de UUIDs)');
      }

      const res = await api.put(`/ecommerce-collections/${args.id}/products`, {
        productIds: args.product_ids,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ productCount: args.product_ids.length }, 'Productos de la colección actualizados');
    },
  },
};
