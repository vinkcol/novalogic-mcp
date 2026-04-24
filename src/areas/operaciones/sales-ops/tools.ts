/**
 * Sales Ops Agent — Sales/POS Management via Internal API
 */

import { api } from '../../../services/api-client.js';

function err(message: string) {
  return { error: message };
}

function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

export const tools = {

  sales_ops_list: {
    description: '[Sales Ops] Listar ventas con filtros (estado, fecha, paginacion).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'number', description: 'Pagina (default 1)' },
        limit: { type: 'number', description: 'Items por pagina (default 20)' },
        status: { type: 'string', description: 'Filtrar por estado: pending, confirmed, completed, cancelled' },
        date_from: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
        date_to: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      if (args.status) params.set('status', args.status);
      if (args.date_from) params.set('dateFrom', args.date_from);
      if (args.date_to) params.set('dateTo', args.date_to);
      const res = await api.get(`/sales?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sales: res.data });
    },
  },

  sales_ops_search: {
    description: '[Sales Ops] Buscar ventas por termino (nombre cliente, email, numero de venta).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Termino de busqueda' },
      },
      required: ['q'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/sales/search?q=${encodeURIComponent(args.q)}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ results: res.data });
    },
  },

  sales_ops_get: {
    description: '[Sales Ops] Obtener detalle de una venta por ID (incluye items, cliente, envio).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'UUID de la venta' },
      },
      required: ['sale_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/sales/${args.sale_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data });
    },
  },

  sales_ops_create: {
    description: '[Sales Ops] Crear nueva venta online con items. Para tienda física usar sales_ops_create_pos.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'UUID del cliente' },
        items: {
          type: 'array',
          description: 'Items de la venta',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'string', description: 'UUID del producto' },
              inventory_item_id: { type: 'string', description: 'UUID del item de inventario (requerido para reservar stock)' },
              quantity: { type: 'number' },
              unit_price: { type: 'number' },
            },
          },
        },
        payment_method: {
          type: 'string',
          description: 'Método de pago: cash | transfer | card | nequi | daviplata | contraentrega',
        },
        origin: {
          type: 'string',
          description: 'Origen de la venta: internal (default) | ecommerce | pos',
        },
        seller_id: {
          type: 'string',
          description: 'UUID del empleado vendedor. Si no se provee, el sistema resuelve el seller del usuario autenticado.',
        },
        shipping_info: {
          type: 'object',
          description: 'Información de envío (obligatorio para ventas online con despacho)',
          properties: {
            address: { type: 'string', description: 'Dirección de entrega' },
            city: { type: 'string', description: 'Nombre de la ciudad' },
            city_id: { type: 'string', description: 'UUID de la ciudad (para resolver cobertura y costo)' },
            department: { type: 'string', description: 'Nombre del departamento' },
            department_id: { type: 'string', description: 'UUID del departamento' },
            recipient_name: { type: 'string', description: 'Nombre del destinatario' },
            recipient_phone: { type: 'string', description: 'Teléfono del destinatario' },
            additional_info: { type: 'string', description: 'Indicaciones adicionales' },
          },
        },
        sale_date: {
          type: 'string',
          description: '[Solo Internal API] Fecha real de la venta ISO 8601 (ej: 2025-11-15T10:00:00Z). Permite emular ventas históricas.',
        },
        delivery_date: {
          type: 'string',
          description: 'Fecha programada de entrega ISO 8601 (ej: 2026-04-21T00:00:00Z). OBLIGATORIO cuando se incluye shipping_info.',
        },
        notes: { type: 'string', description: 'Notas opcionales' },
      },
      required: ['items', 'payment_method'],
    },
    handler: async (args: any) => {
      if (args.shipping_info && !args.delivery_date) {
        return err('delivery_date es obligatorio para ventas online con despacho (shipping_info presente). Calcula: fecha_venta + días estimados según ciudad destino (Bogotá +1d, Medellín/Cali/Eje +2d, Costa +3d).');
      }
      const body: any = {
        customerId: args.customer_id,
        location: 'online',
        origin: args.origin ?? 'internal',
        paymentMethod: args.payment_method,
        sellerId: args.seller_id,
        notes: args.notes,
        saleDate: args.sale_date,
        deliveryDate: args.delivery_date,
        items: args.items?.map((i: any) => ({
          productId: i.product_id,
          inventoryItemId: i.inventory_item_id,
          quantity: i.quantity,
          unitPrice: i.unit_price,
        })),
      };
      if (args.shipping_info) {
        body.shippingInfo = {
          address: args.shipping_info.address,
          city: args.shipping_info.city,
          cityId: args.shipping_info.city_id,
          department: args.shipping_info.department,
          departmentId: args.shipping_info.department_id,
          recipientName: args.shipping_info.recipient_name,
          recipientPhone: args.shipping_info.recipient_phone,
          additionalInfo: args.shipping_info.additional_info,
        };
      }
      const res = await api.post('/sales', body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Venta creada exitosamente');
    },
  },

  sales_ops_create_pos: {
    description: '[Sales Ops] Crear venta POS (tienda física, entrega inmediata). La venta queda completed automáticamente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        items: {
          type: 'array',
          description: 'Items de la venta POS',
          items: {
            type: 'object',
            properties: {
              product_id: { type: 'string', description: 'UUID del producto' },
              inventory_item_id: { type: 'string', description: 'UUID del item de inventario (requerido para reservar stock)' },
              quantity: { type: 'number' },
              unit_price: { type: 'number' },
            },
          },
        },
        customer_id: { type: 'string', description: 'UUID del cliente (opcional para POS)' },
        payment_method: {
          type: 'string',
          description: 'Método de pago: cash | transfer | card | nequi | daviplata',
        },
        seller_id: {
          type: 'string',
          description: 'UUID del empleado vendedor.',
        },
        sale_date: {
          type: 'string',
          description: '[Solo Internal API] Fecha real ISO 8601 para emular ventas históricas.',
        },
        notes: { type: 'string', description: 'Notas opcionales' },
      },
      required: ['items', 'payment_method'],
    },
    handler: async (args: any) => {
      const res = await api.post('/sales/pos', {
        customerId: args.customer_id,
        location: 'store',
        origin: 'pos',
        paymentMethod: args.payment_method,
        sellerId: args.seller_id,
        saleDate: args.sale_date,
        notes: args.notes,
        items: args.items?.map((i: any) => ({
          productId: i.product_id,
          inventoryItemId: i.inventory_item_id,
          quantity: i.quantity,
          unitPrice: i.unit_price,
        })),
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Venta POS creada');
    },
  },

  sales_ops_update: {
    description: '[Sales Ops] Actualizar datos de una venta (cliente, notas, fecha de entrega).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'UUID de la venta' },
        customer_id: { type: 'string' },
        notes: { type: 'string' },
        delivery_date: {
          type: 'string',
          description: 'Fecha programada de entrega ISO 8601 (ej: 2026-04-21T00:00:00Z). OBLIGATORIO para ventas online con despacho.',
        },
      },
      required: ['sale_id'],
    },
    handler: async (args: any) => {
      const { sale_id, ...data } = args;
      const res = await api.put(`/sales/${sale_id}`, {
        customerId: data.customer_id,
        notes: data.notes,
        deliveryDate: data.delivery_date,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Venta actualizada');
    },
  },

  sales_ops_add_item: {
    description: '[Sales Ops] Agregar item a una venta existente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'UUID de la venta' },
        product_id: { type: 'string', description: 'UUID del producto' },
        quantity: { type: 'number', description: 'Cantidad' },
        unit_price: { type: 'number', description: 'Precio unitario' },
      },
      required: ['sale_id', 'product_id', 'quantity', 'unit_price'],
    },
    handler: async (args: any) => {
      const res = await api.post(`/sales/${args.sale_id}/items`, {
        productId: args.product_id,
        quantity: args.quantity,
        unitPrice: args.unit_price,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Item agregado');
    },
  },

  sales_ops_update_item: {
    description: '[Sales Ops] Actualizar item de una venta (cantidad, precio).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string' },
        item_id: { type: 'string' },
        quantity: { type: 'number' },
        unit_price: { type: 'number' },
      },
      required: ['sale_id', 'item_id'],
    },
    handler: async (args: any) => {
      const res = await api.put(`/sales/${args.sale_id}/items/${args.item_id}`, {
        quantity: args.quantity,
        unitPrice: args.unit_price,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Item actualizado');
    },
  },

  sales_ops_link_item: {
    description: '[Sales Ops] Vincular o desvincular un item de venta del catálogo (productId/inventoryItemId). Pasar null en product_id e inventory_item_id para desvincular (rollback).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'UUID de la venta' },
        item_id: { type: 'string', description: 'UUID del sale item' },
        product_id: { type: 'string', description: 'UUID del producto en el catálogo, o null para desvincular' },
        inventory_item_id: { type: 'string', description: 'UUID del item de inventario, o null para desvincular' },
        reason: { type: 'string', description: 'Razón del cambio (obligatorio para auditoría)' },
      },
      required: ['sale_id', 'item_id', 'reason'],
    },
    handler: async (args: any) => {
      const res = await api.patch(`/sales/${args.sale_id}/items/${args.item_id}/link-product`, {
        productId: args.product_id ?? null,
        inventoryItemId: args.inventory_item_id ?? null,
        reason: args.reason,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      const action = args.product_id ? 'vinculado al catálogo' : 'desvinculado del catálogo';
      return ok({ sale: res.data }, `Item ${action} correctamente`);
    },
  },

  sales_ops_remove_item: {
    description: '[Sales Ops] Eliminar item de una venta.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string' },
        item_id: { type: 'string' },
      },
      required: ['sale_id', 'item_id'],
    },
    handler: async (args: any) => {
      const res = await api.del(`/sales/${args.sale_id}/items/${args.item_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Item eliminado');
    },
  },

  sales_ops_confirm: {
    description: '[Sales Ops] Confirmar una venta pendiente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'UUID de la venta' },
      },
      required: ['sale_id'],
    },
    handler: async (args: any) => {
      const res = await api.post(`/sales/${args.sale_id}/confirm`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Venta confirmada');
    },
  },

  sales_ops_complete: {
    description: '[Sales Ops] Marcar venta como completada/entregada.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'UUID de la venta' },
      },
      required: ['sale_id'],
    },
    handler: async (args: any) => {
      const res = await api.post(`/sales/${args.sale_id}/complete`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Venta completada');
    },
  },

  sales_ops_cancel: {
    description: '[Sales Ops] Cancelar una venta con razon.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'UUID de la venta' },
        reason: { type: 'string', description: 'Razon de cancelacion' },
      },
      required: ['sale_id', 'reason'],
    },
    handler: async (args: any) => {
      const res = await api.post(`/sales/${args.sale_id}/cancel`, { reason: args.reason });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Venta cancelada');
    },
  },

  sales_ops_change_status: {
    description: '[Sales Ops] Cambiar estado de una venta (transicion generica).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string' },
        status: { type: 'string', description: 'Nuevo estado' },
        notes: { type: 'string', description: 'Notas opcionales' },
      },
      required: ['sale_id', 'status'],
    },
    handler: async (args: any) => {
      const res = await api.patch(`/sales/${args.sale_id}/status`, {
        status: args.status,
        notes: args.notes,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, `Estado cambiado a ${args.status}`);
    },
  },

  sales_ops_statistics: {
    description: '[Sales Ops] Obtener estadisticas de ventas (totales, revenue, por estado).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
        end_date: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.start_date) params.set('startDate', args.start_date);
      if (args.end_date) params.set('endDate', args.end_date);
      const res = await api.get(`/sales/statistics?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ statistics: res.data });
    },
  },

  sales_ops_daily_summary: {
    description: '[Sales Ops] Resumen de ventas del dia.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'Fecha YYYY-MM-DD (default: hoy)' },
      },
    },
    handler: async (args: any) => {
      const date = args.date || new Date().toISOString().split('T')[0];
      const res = await api.get(`/sales/daily-summary?date=${date}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ summary: res.data });
    },
  },

  sales_ops_set_shipping: {
    description: '[Sales Ops] Establecer o corregir el costo de envío de una venta. Puede marcar como override manual.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'UUID de la venta' },
        cost: { type: 'number', description: 'Nuevo costo de envío (cobro al cliente)' },
        carrier: { type: 'string', description: 'Nombre del carrier (opcional)' },
        tracking_number: { type: 'string', description: 'Número de guía (opcional)' },
        override: { type: 'boolean', description: 'Marcar como override manual (opcional)' },
        override_reason: { type: 'string', description: 'Razón del override (opcional)' },
      },
      required: ['sale_id', 'cost'],
    },
    handler: async (args: any) => {
      const body: any = { cost: args.cost };
      if (args.carrier) body.carrier = args.carrier;
      if (args.tracking_number) body.trackingNumber = args.tracking_number;
      if (args.override !== undefined) body.override = args.override;
      if (args.override_reason) body.overrideReason = args.override_reason;
      const res = await api.post(`/sales/${args.sale_id}/shipping`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, `Costo de envío actualizado a ${args.cost}`);
    },
  },

  sales_ops_apply_discount: {
    description: '[Sales Ops] Aplicar descuento a una venta.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string' },
        discount_type: { type: 'string', description: 'percentage o fixed' },
        discount_value: { type: 'number', description: 'Valor del descuento' },
      },
      required: ['sale_id', 'discount_type', 'discount_value'],
    },
    handler: async (args: any) => {
      const res = await api.post(`/sales/${args.sale_id}/discount`, {
        discountType: args.discount_type,
        discountValue: args.discount_value,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, 'Descuento aplicado');
    },
  },

  sales_ops_set_delivery_date: {
    description: '[Sales Ops] Establecer o corregir la fecha de entrega de una venta online, en cualquier estado. Requiere razón de corrección para auditoría. La fecha debe calcularse según la ciudad destino: Bogotá +1 día hábil, Medellín/Cali/Eje Cafetero/Santanderes +2 días, Costa Caribe +3 días.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'ID de la venta (UUID)' },
        delivery_date: { type: 'string', description: 'Fecha de entrega ISO 8601 (ej: 2026-04-21T00:00:00Z)' },
        reason: { type: 'string', description: 'Razón de la corrección (requerido para auditoría). Ej: "Corrección inicial — venta creada sin delivery_date"' },
      },
      required: ['sale_id', 'delivery_date', 'reason'],
    },
    handler: async (args: any) => {
      const res = await api.patch(`/sales/${args.sale_id}/delivery-date`, {
        delivery_date: args.delivery_date,
        reason: args.reason,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sale: res.data }, `Fecha de entrega actualizada a ${args.delivery_date}`);
    },
  },

  sales_ops_top_products: {
    description: '[Sales Ops] Productos más vendidos en un período. Default: mes actual, top 10.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (default: inicio del mes)' },
        end_date: { type: 'string', description: 'Fecha fin YYYY-MM-DD (default: hoy)' },
        limit: { type: 'number', description: 'Cantidad de productos (default 10)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.start_date) params.set('startDate', args.start_date);
      if (args.end_date) params.set('endDate', args.end_date);
      if (args.limit) params.set('limit', String(args.limit));
      const res = await api.get(`/sales/top-products?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ products: res.data });
    },
  },

  sales_ops_top_customers: {
    description: '[Sales Ops] Clientes con mayor revenue en un período. Default: top 10.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        count: { type: 'number', description: 'Cantidad de clientes (default 10)' },
        start_date: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
        end_date: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.count) params.set('count', String(args.count));
      if (args.start_date) params.set('startDate', args.start_date);
      if (args.end_date) params.set('endDate', args.end_date);
      const res = await api.get(`/sales/top-customers?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ customers: res.data });
    },
  },

  sales_ops_by_seller: {
    description: '[Sales Ops] Ventas de un vendedor específico (paginado). Útil para ranking y evaluación.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        seller_id: { type: 'string', description: 'UUID del vendedor/empleado' },
        page: { type: 'number', description: 'Página (default 1)' },
        limit: { type: 'number', description: 'Items por página (default 20)' },
      },
      required: ['seller_id'],
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const res = await api.get(`/sales/by-seller/${args.seller_id}?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ sales: res.data });
    },
  },
};
