/**
 * Customers Ops Agent — Customer Management via Internal API
 */

import { api } from '../../../services/api-client.js';

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

export const tools = {

  customers_ops_list: {
    description: '[Customers Ops] Listar clientes con paginacion.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'number', description: 'Pagina (default 1)' },
        limit: { type: 'number', description: 'Items por pagina (default 20)' },
      },
    },
    handler: async (args: any) => {
      const res = await api.get(`/customers?page=${args.page || 1}&limit=${args.limit || 20}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ customers: res.data });
    },
  },

  customers_ops_search: {
    description: '[Customers Ops] Buscar clientes por nombre, email, telefono o documento.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        q: { type: 'string', description: 'Termino de busqueda' },
      },
      required: ['q'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/customers/search?q=${encodeURIComponent(args.q)}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ results: res.data });
    },
  },

  customers_ops_get: {
    description: '[Customers Ops] Obtener detalle de un cliente con direcciones.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'UUID del cliente' },
      },
      required: ['customer_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/customers/${args.customer_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ customer: res.data });
    },
  },

  customers_ops_create: {
    description: '[Customers Ops] Crear nuevo cliente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        first_name: { type: 'string', description: 'Nombre' },
        last_name: { type: 'string', description: 'Apellido' },
        email: { type: 'string', description: 'Email' },
        phone: { type: 'string', description: 'Telefono' },
        document_type: { type: 'string', description: 'CC, NIT, CE, etc.' },
        document_number: { type: 'string', description: 'Numero de documento' },
      },
      required: ['first_name', 'last_name'],
    },
    handler: async (args: any) => {
      const res = await api.post('/customers', {
        firstName: args.first_name,
        lastName: args.last_name,
        email: args.email,
        phone: args.phone,
        documentType: args.document_type,
        documentNumber: args.document_number,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ customer: res.data }, 'Cliente creado');
    },
  },

  customers_ops_update: {
    description: '[Customers Ops] Actualizar datos de un cliente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'UUID del cliente' },
        first_name: { type: 'string' },
        last_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
      },
      required: ['customer_id'],
    },
    handler: async (args: any) => {
      const { customer_id, ...data } = args;
      const res = await api.put(`/customers/${customer_id}`, {
        firstName: data.first_name,
        lastName: data.last_name,
        email: data.email,
        phone: data.phone,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ customer: res.data }, 'Cliente actualizado');
    },
  },

  customers_ops_delete: {
    description: '[Customers Ops] Eliminar un cliente (soft delete).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'UUID del cliente' },
      },
      required: ['customer_id'],
    },
    handler: async (args: any) => {
      const res = await api.del(`/customers/${args.customer_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Cliente eliminado');
    },
  },

  customers_ops_add_address: {
    description: '[Customers Ops] Agregar direccion a un cliente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'UUID del cliente' },
        address: { type: 'string', description: 'Direccion' },
        city: { type: 'string', description: 'Ciudad' },
        department: { type: 'string', description: 'Departamento' },
        neighborhood: { type: 'string', description: 'Barrio' },
        zip_code: { type: 'string', description: 'Codigo postal' },
        notes: { type: 'string', description: 'Notas adicionales' },
      },
      required: ['customer_id', 'address', 'city'],
    },
    handler: async (args: any) => {
      const { customer_id, ...data } = args;
      const res = await api.post(`/customers/${customer_id}/addresses`, data);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ address: res.data }, 'Direccion agregada');
    },
  },

  customers_ops_update_address: {
    description: '[Customers Ops] Actualizar direccion de un cliente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        address_id: { type: 'string', description: 'UUID de la direccion' },
        address: { type: 'string' },
        city: { type: 'string' },
        department: { type: 'string' },
      },
      required: ['address_id'],
    },
    handler: async (args: any) => {
      const { address_id, ...data } = args;
      const res = await api.put(`/customers/addresses/${address_id}`, data);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ address: res.data }, 'Direccion actualizada');
    },
  },

  customers_ops_stats: {
    description: '[Customers Ops] Obtener estadisticas de clientes (total, activos, nuevos).',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/customers/stats');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ stats: res.data });
    },
  },

  customers_ops_enrich_addresses: {
    description: '[Customers Ops] Obtener direcciones (city, department, locality, neighborhood) de todos los clientes o de una empresa — útil para enriquecer dim_customers en analytics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'string', description: 'UUID de la empresa (opcional; sin él retorna todos)' },
      },
    },
    handler: async (args: any) => {
      const qs = args.company_id ? `?company_id=${encodeURIComponent(args.company_id)}` : '';
      const res = await api.get(`/customers/addresses-bulk${qs}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      const rows = Array.isArray(res.data) ? res.data : [];
      const withAddress = rows.filter((r: any) => r.city);
      return ok({
        total: rows.length,
        with_address: withAddress.length,
        without_address: rows.length - withAddress.length,
        addresses: rows,
      });
    },
  },

  customers_ops_purchase_history: {
    description: '[Customers Ops] Historial de compras (ventas) de un cliente. Incluye nombre del cliente y ventas paginadas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        customer_id: { type: 'string', description: 'UUID del cliente' },
        page: { type: 'number', description: 'Página (default 1)' },
        limit: { type: 'number', description: 'Items por página (default 20)' },
      },
      required: ['customer_id'],
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const res = await api.get(`/customers/${args.customer_id}/purchase-history?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },
};
