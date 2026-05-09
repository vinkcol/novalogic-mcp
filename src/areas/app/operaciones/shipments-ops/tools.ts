/**
 * Shipments Ops Agent — Shipment & Delivery Management via Internal API
 */

import { api } from '../../../../services/api-client.js';

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

export const tools = {

  shipments_ops_list: {
    description: '[Shipments Ops] Listar envios con filtros.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'number' },
        limit: { type: 'number' },
        status: { type: 'string', description: 'Filtrar por estado' },
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
      const res = await api.get(`/shipments?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ shipments: res.data });
    },
  },

  shipments_ops_get: {
    description: '[Shipments Ops] Obtener detalle de un envio por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        shipment_id: { type: 'string', description: 'UUID del envio' },
      },
      required: ['shipment_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/shipments/${args.shipment_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ shipment: res.data });
    },
  },

  shipments_ops_create: {
    description: '[Shipments Ops] Crear envio a partir de una venta.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        sale_id: { type: 'string', description: 'UUID de la venta asociada' },
        carrier_id: { type: 'string', description: 'UUID del carrier/transportadora' },
        address: { type: 'string', description: 'Direccion de entrega' },
        city: { type: 'string', description: 'Ciudad' },
        department: { type: 'string', description: 'Departamento' },
        notes: { type: 'string', description: 'Notas para el mensajero' },
      },
      required: ['sale_id'],
    },
    handler: async (args: any) => {
      const res = await api.post('/shipments', {
        saleId: args.sale_id,
        carrierId: args.carrier_id,
        address: args.address,
        city: args.city,
        department: args.department,
        notes: args.notes,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ shipment: res.data }, 'Envio creado');
    },
  },

  shipments_ops_update: {
    description: '[Shipments Ops] Actualizar datos de un envio.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        shipment_id: { type: 'string' },
        address: { type: 'string' },
        city: { type: 'string' },
        notes: { type: 'string' },
        carrier_id: { type: 'string' },
      },
      required: ['shipment_id'],
    },
    handler: async (args: any) => {
      const { shipment_id, ...data } = args;
      const res = await api.put(`/shipments/${shipment_id}`, {
        address: data.address,
        city: data.city,
        notes: data.notes,
        carrierId: data.carrier_id,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ shipment: res.data }, 'Envio actualizado');
    },
  },

  shipments_ops_change_status: {
    description: '[Shipments Ops] Cambiar estado de un envio.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        shipment_id: { type: 'string' },
        status: { type: 'string', description: 'Nuevo estado: picked_up, in_transit, out_for_delivery, delivered, returned, failed' },
        notes: { type: 'string', description: 'Notas opcionales' },
        row_version: { type: 'string', description: 'Optimistic concurrency token returned by the previous shipment read; prevents overwriting concurrent updates' },
        carrier_id: { type: 'string', description: 'UUID del carrier al que se reasigna el envio (opcional)' },
        rescheduled_date: { type: 'string', description: 'ISO date when the delivery is rescheduled (opcional)' },
      },
      required: ['shipment_id', 'status'],
    },
    handler: async (args: any) => {
      const body: any = {
        status: args.status,
        notes: args.notes,
      };
      if (args.row_version !== undefined) body.rowVersion = args.row_version;
      if (args.carrier_id !== undefined) body.carrierId = args.carrier_id;
      if (args.rescheduled_date !== undefined) body.rescheduledDate = args.rescheduled_date;
      const res = await api.patch(`/shipments/${args.shipment_id}/status`, body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ shipment: res.data }, `Estado cambiado a ${args.status}`);
    },
  },

  shipments_ops_history: {
    description: '[Shipments Ops] Consulta el historial completo de estados de un envío — trazabilidad de todas las transiciones con fecha, notas y responsable.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        shipment_id: { type: 'string', description: 'UUID del envío' },
      },
      required: ['shipment_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/shipments/${args.shipment_id}/history`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ history: res.data });
    },
  },

  shipments_ops_revert_to_preparation: {
    description: '[Shipments Ops] Revierte un envío de out_for_dispatch → in_preparation. Solo para correcciones operativas explícitas. Requiere razón.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        shipment_id: { type: 'string', description: 'UUID del envío' },
        reason: { type: 'string', description: 'Motivo del revert (requerido)' },
      },
      required: ['shipment_id', 'reason'],
    },
    handler: async (args: any) => {
      const res = await api.patch(`/shipments/${args.shipment_id}/revert-to-preparation`, {
        reason: args.reason,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ shipment: res.data }, 'Envío revertido a in_preparation');
    },
  },

  shipments_ops_track: {
    description: '[Shipments Ops] Rastrear envio por numero de tracking.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        tracking_number: { type: 'string', description: 'Numero de tracking' },
      },
      required: ['tracking_number'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/shipments/tracking/${encodeURIComponent(args.tracking_number)}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ shipment: res.data });
    },
  },

  shipments_ops_pending: {
    description: '[Shipments Ops] Listar envios pendientes de despacho (paginado).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        page: { type: 'number', description: 'Pagina (default 1)' },
        limit: { type: 'number', description: 'Items por pagina (default 20)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.page) params.set('page', String(args.page));
      if (args.limit) params.set('limit', String(args.limit));
      const qs = params.toString();
      const res = await api.get('/shipments/pending' + (qs ? '?' + qs : ''));
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ shipments: res.data });
    },
  },

  shipments_ops_overdue: {
    description: '[Shipments Ops] Listar envios vencidos/retrasados.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/shipments/overdue');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ shipments: res.data });
    },
  },

  shipments_ops_statistics: {
    description: '[Shipments Ops] Estadisticas de envios (totales, por estado, tiempos promedio).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string' },
        end_date: { type: 'string' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.start_date) params.set('startDate', args.start_date);
      if (args.end_date) params.set('endDate', args.end_date);
      const res = await api.get(`/shipments/statistics?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ statistics: res.data });
    },
  },

  shipments_ops_routes_list: {
    description: '[Shipments Ops] Listar rutas de entrega.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/shipments/routes');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ routes: res.data });
    },
  },

  shipments_ops_route_create: {
    description: '[Shipments Ops] Crear nueva ruta de entrega.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre de la ruta' },
        driver_id: { type: 'string', description: 'UUID del conductor' },
        scheduled_date: { type: 'string', description: 'Fecha programada YYYY-MM-DD' },
      },
      required: ['name'],
    },
    handler: async (args: any) => {
      const res = await api.post('/shipments/routes', {
        name: args.name,
        driverId: args.driver_id,
        scheduledDate: args.scheduled_date,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ route: res.data }, 'Ruta creada');
    },
  },

  shipments_ops_route_assign: {
    description: '[Shipments Ops] Asignar envios a una ruta de entrega.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        route_id: { type: 'string', description: 'UUID de la ruta' },
        shipment_ids: {
          type: 'array',
          description: 'Array de UUIDs de envios a asignar',
          items: { type: 'string' },
        },
      },
      required: ['route_id', 'shipment_ids'],
    },
    handler: async (args: any) => {
      const res = await api.post('/shipments/routes/assign-shipments', {
        routeId: args.route_id,
        shipmentIds: args.shipment_ids,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, 'Envios asignados a la ruta');
    },
  },
// ── Reconciliation Findings ──  shipments_ops_record_finding: {    description: "[Shipments Ops] Registrar hallazgo de conciliacion en una remesa. Tipos: status_mismatch, value_mismatch, zone_mismatch, missing_in_system, missing_in_courier, late_delivery, retained_no_reason, unauthorized_return, flete_discrepancy, payment_not_collected.",    inputSchema: {      type: "object" as const,      properties: {        remittance_id: { type: "string", description: "UUID de la remesa" },        shipment_id: { type: "string", description: "UUID del envio (opcional)" },        type: { type: "string", enum: ["status_mismatch", "value_mismatch", "zone_mismatch", "missing_in_system", "missing_in_courier", "late_delivery", "retained_no_reason", "unauthorized_return", "flete_discrepancy", "payment_not_collected"], description: "Tipo de hallazgo" },        severity: { type: "string", enum: ["info", "warning", "critical"], description: "Severidad (default: warning)" },        description: { type: "string", description: "Descripcion del hallazgo" },        courier_data: { type: "object", description: "Datos reportados por el courier (estado, valor, fecha)" },        system_data: { type: "object", description: "Datos que tiene Novalogic" },        source: { type: "string", enum: ["auto_reconciliation", "manual"], description: "Origen (default: manual)" },      },      required: ["remittance_id", "type", "description"],    },    handler: async (args: any) => {      const body: any = {        type: args.type,        description: args.description,      };      if (args.shipment_id) body.shipmentId = args.shipment_id;      if (args.severity) body.severity = args.severity;      if (args.courier_data) body.courierData = args.courier_data;      if (args.system_data) body.systemData = args.system_data;      if (args.source) body.source = args.source;      const res = await api.post(`/logistics/carrier-remittances/${args.remittance_id}/findings`, body);      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);      return ok({ finding: res.data }, "Hallazgo registrado");    },  },  shipments_ops_list_findings: {    description: "[Shipments Ops] Listar hallazgos de conciliacion de una remesa.",    inputSchema: {      type: "object" as const,      properties: {        remittance_id: { type: "string", description: "UUID de la remesa" },      },      required: ["remittance_id"],    },    handler: async (args: any) => {      const res = await api.get(`/logistics/carrier-remittances/${args.remittance_id}/findings`);      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);      return ok({ findings: res.data });    },  },  shipments_ops_resolve_finding: {    description: "[Shipments Ops] Actualizar o resolver un hallazgo de conciliacion.",    inputSchema: {      type: "object" as const,      properties: {        remittance_id: { type: "string", description: "UUID de la remesa" },        finding_id: { type: "string", description: "UUID del hallazgo" },        status: { type: "string", enum: ["open", "acknowledged", "disputed", "resolved"], description: "Nuevo estado" },        resolution: { type: "string", description: "Descripcion de la resolucion" },      },      required: ["remittance_id", "finding_id"],    },    handler: async (args: any) => {      const body: any = {};      if (args.status) body.status = args.status;      if (args.resolution) body.resolution = args.resolution;      const res = await api.patch(`/logistics/carrier-remittances/${args.remittance_id}/findings/${args.finding_id}`, body);      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);      return ok({ finding: res.data }, "Hallazgo actualizado");    },  },  shipments_ops_findings_summary: {    description: "[Shipments Ops] Resumen de hallazgos de conciliacion por remesa (conteo por tipo y severidad).",    inputSchema: {      type: "object" as const,      properties: {        remittance_id: { type: "string", description: "UUID de la remesa" },      },      required: ["remittance_id"],    },    handler: async (args: any) => {      const res = await api.get(`/logistics/carrier-remittances/${args.remittance_id}/findings/summary`);      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);      return ok({ summary: res.data });    },  },
};
