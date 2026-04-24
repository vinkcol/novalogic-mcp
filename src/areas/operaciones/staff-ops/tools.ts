/**
 * Staff Ops — Employee management via Internal API
 */

import { api } from '../../../services/api-client.js';

function err(message: string) {
  return { error: message };
}

function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

export const tools = {

  staff_ops_list: {
    description: '[Staff Ops] Listar empleados de la empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        search: { type: 'string', description: 'Buscar por nombre o email' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.search) params.set('search', args.search);
      const res = await api.get(`/staff?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      const employees = Array.isArray(res.data?.items) ? res.data.items : (Array.isArray(res.data) ? res.data : []);
      return ok({
        employees: employees.map((e: any) => ({
          id: e.id,
          name: `${e.firstName} ${e.lastName}`.trim(),
          email: e.email,
          position: e.position?.name ?? e.positionId,
          status: e.status,
        })),
        count: employees.length,
      });
    },
  },

  staff_ops_create: {
    description: '[Staff Ops] Crear un empleado. Requiere position_id (obtener con staff_ops_list_positions).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        first_name: { type: 'string', description: 'Nombre' },
        last_name: { type: 'string', description: 'Apellido' },
        position_id: { type: 'string', description: 'UUID del cargo/posición' },
        email: { type: 'string', description: 'Email (opcional)' },
        phone: { type: 'string', description: 'Teléfono (opcional)' },
        department: { type: 'string', description: 'Departamento/área (opcional)' },
        status: {
          type: 'string',
          description: 'Estado: active (default) | inactive | on_leave',
        },
      },
      required: ['first_name', 'last_name', 'position_id'],
    },
    handler: async (args: any) => {
      const res = await api.post('/staff', {
        firstName: args.first_name,
        lastName: args.last_name,
        positionId: args.position_id,
        email: args.email,
        phone: args.phone,
        department: args.department,
        status: args.status ?? 'active',
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ employee: res.data }, `Empleado "${args.first_name} ${args.last_name}" creado`);
    },
  },

  staff_ops_get: {
    description: '[Staff Ops] Obtener detalle de un empleado por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        employee_id: { type: 'string', description: 'UUID del empleado' },
      },
      required: ['employee_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/staff/${args.employee_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ employee: res.data });
    },
  },

  staff_ops_update: {
    description: '[Staff Ops] Actualizar datos de un empleado. Todos los campos son opcionales.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        employee_id: { type: 'string', description: 'UUID del empleado a actualizar' },
        first_name: { type: 'string', description: 'Nombre' },
        last_name: { type: 'string', description: 'Apellido' },
        email: { type: 'string', description: 'Email' },
        phone: { type: 'string', description: 'Teléfono' },
        position_id: { type: 'string', description: 'UUID del cargo/posición' },
        department: { type: 'string', description: 'Departamento/área' },
        status: {
          type: 'string',
          description: 'Estado: active | inactive | on_leave',
        },
      },
      required: ['employee_id'],
    },
    handler: async (args: any) => {
      const body: Record<string, any> = {};
      if (args.first_name) body.firstName = args.first_name;
      if (args.last_name) body.lastName = args.last_name;
      if (args.email) body.email = args.email;
      if (args.phone) body.phone = args.phone;
      if (args.position_id) body.positionId = args.position_id;
      if (args.department) body.department = args.department;
      if (args.status) body.status = args.status;
      const res = await api.put(`/staff/${args.employee_id}`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ employee: res.data }, `Empleado actualizado`);
    },
  },

  staff_ops_delete: {
    description: '[Staff Ops] Eliminar (desactivar) un empleado por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        employee_id: { type: 'string', description: 'UUID del empleado' },
      },
      required: ['employee_id'],
    },
    handler: async (args: any) => {
      const res = await api.del(`/staff/${args.employee_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, `Empleado eliminado`);
    },
  },

};
