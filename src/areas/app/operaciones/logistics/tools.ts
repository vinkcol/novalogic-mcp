/**
 * Logistics Agent — Shipping zones management via Internal API.
 *
 * Manages shipping zones, subzones and city assignments through
 * the Novalogic Internal API deterministically (no direct DB or code changes).
 */

import { api } from '../../../../services/api-client.js';

// ============================================================
// Helpers
// ============================================================

function err(message: string) {
  return { error: message };
}

function ok(data: any, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

// ============================================================
// Tools
// ============================================================

export const tools = {

  // ----------------------------------------------------------
  // ZONES
  // ----------------------------------------------------------

  logistics_list_zones: {
    description: '[Logistics] Listar todas las zonas de envío de la empresa autenticada.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/logistics/zones');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      const zones = Array.isArray(res.data) ? res.data : [];
      return ok({
        zones: zones.map((z: any) => ({
          id: z.id,
          name: z.name,
          carrierName: z.carrier?.name,
          carrierId: z.carrierId,
          priority: z.priority,
          isActive: z.isActive,
          subZoneCount: z.subZoneCount ?? z.subZones?.length ?? 0,
        })),
        count: zones.length,
      });
    },
  },

  logistics_get_zone: {
    description: '[Logistics] Obtener detalle de una zona con sus subzonas y ciudades.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'UUID de la zona' },
      },
      required: ['zone_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/logistics/zones/${args.zone_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ zone: res.data });
    },
  },

  logistics_create_zone: {
    description: '[Logistics] Crear una nueva zona de envío.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        carrier_id: { type: 'string', description: 'UUID del carrier/transportadora' },
        name: { type: 'string', description: 'Nombre de la zona (ej: Zona Local, Zona Nacional)' },
        description: { type: 'string', description: 'Descripción opcional' },
        priority: { type: 'number', description: 'Prioridad (1=más alta). Default: 1' },
        is_active: { type: 'boolean', description: 'Default: true' },
      },
      required: ['carrier_id', 'name'],
    },
    handler: async (args: any) => {
      const body: any = {
        carrierId: args.carrier_id,
        name: args.name,
      };
      if (args.description) body.description = args.description;
      if (args.priority !== undefined) body.priority = args.priority;
      if (args.is_active !== undefined) body.isActive = args.is_active;

      const res = await api.post('/logistics/zones', body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ zone: res.data }, `Zona "${args.name}" creada`);
    },
  },

  logistics_update_zone: {
    description: '[Logistics] Actualizar una zona de envío.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'UUID de la zona' },
        name: { type: 'string' },
        description: { type: 'string' },
        carrier_id: { type: 'string' },
        priority: { type: 'number' },
        is_active: { type: 'boolean' },
      },
      required: ['zone_id'],
    },
    handler: async (args: any) => {
      const body: any = {};
      if (args.name) body.name = args.name;
      if (args.description !== undefined) body.description = args.description;
      if (args.carrier_id) body.carrierId = args.carrier_id;
      if (args.priority !== undefined) body.priority = args.priority;
      if (args.is_active !== undefined) body.isActive = args.is_active;

      const res = await api.put(`/logistics/zones/${args.zone_id}`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ zone: res.data }, 'Zona actualizada');
    },
  },

  logistics_delete_zone: {
    description: '[Logistics] Eliminar zona (soft delete, cascada a subzonas).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'UUID de la zona' },
      },
      required: ['zone_id'],
    },
    handler: async (args: any) => {
      const res = await api.del(`/logistics/zones/${args.zone_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Zona eliminada');
    },
  },

  // ----------------------------------------------------------
  // SUBZONES
  // ----------------------------------------------------------

  logistics_create_subzone: {
    description: '[Logistics] Crear subzona dentro de una zona, opcionalmente con ciudades.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'UUID de la zona padre' },
        name: { type: 'string', description: 'Nombre de la subzona' },
        description: { type: 'string' },
        flete_cost: { type: 'number', description: 'Costo interno flete. Default: 0' },
        client_cost: { type: 'number', description: 'Cobro al cliente. Default: 0' },
        return_cost: { type: 'number', description: 'Costo devolución. Default: 0' },
        estimated_days: { type: 'number', description: 'Días estimados de entrega' },
        is_active: { type: 'boolean' },
        cities: {
          type: 'array',
          description: 'Lista de ciudades [{departmentId, cityId}]',
          items: {
            type: 'object',
            properties: {
              departmentId: { type: 'string' },
              cityId: { type: 'string' },
            },
            required: ['departmentId', 'cityId'],
          },
        },
      },
      required: ['zone_id', 'name'],
    },
    handler: async (args: any) => {
      const body: any = { name: args.name };
      if (args.description) body.description = args.description;
      if (args.flete_cost !== undefined) body.fleteCost = args.flete_cost;
      if (args.client_cost !== undefined) body.clientCost = args.client_cost;
      if (args.return_cost !== undefined) body.returnCost = args.return_cost;
      if (args.estimated_days !== undefined) body.estimatedDays = args.estimated_days;
      if (args.is_active !== undefined) body.isActive = args.is_active;
      if (args.cities) body.cities = args.cities;

      const res = await api.post(`/logistics/zones/${args.zone_id}/subzones`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subZone: res.data }, `Subzona "${args.name}" creada`);
    },
  },

  logistics_list_subzones: {
    description: '[Logistics] Listar subzonas de una zona.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'UUID de la zona' },
      },
      required: ['zone_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/logistics/zones/${args.zone_id}/subzones`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      const subZones = Array.isArray(res.data) ? res.data : [];
      return ok({
        subZones: subZones.map((sz: any) => ({
          id: sz.id,
          name: sz.name,
          fleteCost: sz.fleteCost,
          clientCost: sz.clientCost,
          returnCost: sz.returnCost,
          estimatedDays: sz.estimatedDays,
          isActive: sz.isActive,
          cityCount: sz.cities?.length ?? 0,
        })),
        count: subZones.length,
      });
    },
  },

  logistics_update_subzone: {
    description: '[Logistics] Actualizar subzona (costos, nombre, ciudades).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'UUID de la zona padre' },
        subzone_id: { type: 'string', description: 'UUID de la subzona' },
        name: { type: 'string' },
        description: { type: 'string' },
        flete_cost: { type: 'number' },
        client_cost: { type: 'number' },
        return_cost: { type: 'number' },
        estimated_days: { type: 'number' },
        is_active: { type: 'boolean' },
        cities: {
          type: 'array',
          description: 'Si se proporciona, reemplaza todas las ciudades',
          items: {
            type: 'object',
            properties: {
              departmentId: { type: 'string' },
              cityId: { type: 'string' },
            },
            required: ['departmentId', 'cityId'],
          },
        },
      },
      required: ['zone_id', 'subzone_id'],
    },
    handler: async (args: any) => {
      const body: any = {};
      if (args.name) body.name = args.name;
      if (args.description !== undefined) body.description = args.description;
      if (args.flete_cost !== undefined) body.fleteCost = args.flete_cost;
      if (args.client_cost !== undefined) body.clientCost = args.client_cost;
      if (args.return_cost !== undefined) body.returnCost = args.return_cost;
      if (args.estimated_days !== undefined) body.estimatedDays = args.estimated_days;
      if (args.is_active !== undefined) body.isActive = args.is_active;
      if (args.cities !== undefined) body.cities = args.cities;

      const res = await api.put(
        `/logistics/zones/${args.zone_id}/subzones/${args.subzone_id}`,
        body,
      );
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ subZone: res.data }, 'Subzona actualizada');
    },
  },

  logistics_delete_subzone: {
    description: '[Logistics] Eliminar subzona (soft delete).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'UUID de la zona padre' },
        subzone_id: { type: 'string', description: 'UUID de la subzona' },
      },
      required: ['zone_id', 'subzone_id'],
    },
    handler: async (args: any) => {
      const res = await api.del(
        `/logistics/zones/${args.zone_id}/subzones/${args.subzone_id}`,
      );
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Subzona eliminada');
    },
  },

  // ----------------------------------------------------------
  // CITIES
  // ----------------------------------------------------------

  logistics_replace_cities: {
    description: '[Logistics] Reemplazar todas las ciudades de una subzona.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        zone_id: { type: 'string', description: 'UUID de la zona' },
        subzone_id: { type: 'string', description: 'UUID de la subzona' },
        cities: {
          type: 'array',
          description: 'Lista de {departmentId, cityId}',
          items: {
            type: 'object',
            properties: {
              departmentId: { type: 'string' },
              cityId: { type: 'string' },
            },
            required: ['departmentId', 'cityId'],
          },
        },
      },
      required: ['zone_id', 'subzone_id', 'cities'],
    },
    handler: async (args: any) => {
      const res = await api.put(
        `/logistics/zones/${args.zone_id}/subzones/${args.subzone_id}/cities`,
        { cities: args.cities },
      );
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok(
        { cities: res.data, count: Array.isArray(res.data) ? res.data.length : 0 },
        `${Array.isArray(res.data) ? res.data.length : 0} ciudades asignadas`,
      );
    },
  },

  // ----------------------------------------------------------
  // COVERAGE LOOKUP
  // ----------------------------------------------------------

  logistics_lookup_coverage: {
    description: '[Logistics] Consultar cobertura y costos para una ciudad (lo que ve el POS).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        department_id: { type: 'string', description: 'ID departamento (ej: "12" = Cundinamarca)' },
        city_id: { type: 'string', description: 'ID ciudad (ej: "12-8" = Bogotá)' },
      },
      required: ['department_id', 'city_id'],
    },
    handler: async (args: any) => {
      const params = `departmentId=${args.department_id}&cityId=${args.city_id}`;
      const res = await api.get(`/logistics/coverage/lookup?${params}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ coverage: res.data });
    },
  },

  // ----------------------------------------------------------
  // CARRIERS (read-only, para referencia)
  // ----------------------------------------------------------

  logistics_list_carriers: {
    description: '[Logistics] Listar transportadoras disponibles.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/logistics/carriers');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      const carriers = Array.isArray(res.data) ? res.data : [];
      return ok({
        carriers: carriers.map((c: any) => ({
          id: c.id,
          name: c.name,
          code: c.code,
          isSystem: c.isSystem,
          isActive: c.isActive,
        })),
        count: carriers.length,
      });
    },
  },

  logistics_create_carrier: {
    description: '[Logistics] Crear una transportadora/carrier para la empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre de la transportadora (ej: Coordinadora, TCC, Propio)' },
        code: { type: 'string', description: 'Código corto único (ej: COORD, TCC, PROPIO)' },
        phone: { type: 'string', description: 'Teléfono de contacto (opcional)' },
        email: { type: 'string', description: 'Email de contacto (opcional)' },
        is_active: { type: 'boolean', description: 'Activa por defecto (default: true)' },
        is_default: { type: 'boolean', description: 'Si es la transportadora por defecto' },
      },
      required: ['name', 'code'],
    },
    handler: async (args: any) => {
      const res = await api.post('/logistics/carriers', {
        name: args.name,
        code: args.code,
        phone: args.phone,
        email: args.email,
        isActive: args.is_active ?? true,
        isDefault: args.is_default ?? false,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ carrier: res.data }, `Transportadora "${args.name}" creada`);
    },
  },

  // ----------------------------------------------------------
  // SEED (operación compuesta)
  // ----------------------------------------------------------

  logistics_seed_zones: {
    description:
      '[Logistics] Crear una configuración completa de zonas en una sola operación. ' +
      'Recibe un array de zonas, cada una con sus subzonas y ciudades.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        carrier_id: { type: 'string', description: 'UUID del carrier para todas las zonas' },
        zones: {
          type: 'array',
          description: 'Array de zonas a crear',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
              priority: { type: 'number' },
              subzones: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    description: { type: 'string' },
                    flete_cost: { type: 'number' },
                    client_cost: { type: 'number' },
                    return_cost: { type: 'number' },
                    estimated_days: { type: 'number' },
                    cities: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          departmentId: { type: 'string' },
                          cityId: { type: 'string' },
                        },
                      },
                    },
                  },
                  required: ['name'],
                },
              },
            },
            required: ['name'],
          },
        },
      },
      required: ['carrier_id', 'zones'],
    },
    handler: async (args: any) => {
      const results: any[] = [];

      for (const zoneDef of args.zones) {
        const zoneRes = await api.post('/logistics/zones', {
          carrierId: args.carrier_id,
          name: zoneDef.name,
          description: zoneDef.description,
          priority: zoneDef.priority ?? results.length + 1,
        });

        if (!zoneRes.ok) {
          results.push({ zone: zoneDef.name, error: zoneRes.data });
          continue;
        }

        const zoneId = zoneRes.data.id;
        const subResults: any[] = [];

        for (const szDef of zoneDef.subzones || []) {
          const szBody: any = {
            name: szDef.name,
            description: szDef.description,
            fleteCost: szDef.flete_cost ?? 0,
            clientCost: szDef.client_cost ?? 0,
            returnCost: szDef.return_cost ?? 0,
            estimatedDays: szDef.estimated_days,
            cities: szDef.cities,
          };

          const szRes = await api.post(`/logistics/zones/${zoneId}/subzones`, szBody);
          subResults.push({
            name: szDef.name,
            ok: szRes.ok,
            id: szRes.data?.id,
            cityCount: szDef.cities?.length ?? 0,
          });
        }

        results.push({
          zone: zoneDef.name,
          id: zoneId,
          priority: zoneDef.priority ?? results.length,
          subzones: subResults,
        });
      }

      return ok({ created: results }, `${results.length} zona(s) procesada(s)`);
    },
  },
};
