/**
 * Accounting Ops Agent — Reconciliation, delivery activity & financial summaries via Internal API
 */

import { api } from '../../../../services/api-client.js';

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

export const tools = {

  accounting_ops_daily_reconciliation: {
    description: '[Accounting Ops] Conciliación diaria — cruza ventas agendadas para un día con sus envíos asociados. Devuelve: saleNumber, saleStatus, customerName, shippingCost, total, trackingNumber, shipmentStatus, fleteCost, carrierName, shippingMargin. Incluye resumen con breakdown por estado de venta y envío.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        date: { type: 'string', description: 'Fecha YYYY-MM-DD del día a conciliar' },
      },
      required: ['date'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/accounting/reconciliation/daily?date=${args.date}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ reconciliation: res.data });
    },
  },

  accounting_ops_delivery_activity: {
    description: '[Accounting Ops] Actividad diaria de entregas con revenue, costos de envío y margen. Cruza ventas + envíos por fecha. Útil para conciliación y encontrar primer/último día con entregas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string', description: 'Fecha inicio YYYY-MM-DD' },
        end_date: { type: 'string', description: 'Fecha fin YYYY-MM-DD' },
      },
      required: ['start_date', 'end_date'],
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      params.set('startDate', args.start_date);
      params.set('endDate', args.end_date);
      const res = await api.get(`/accounting/delivery-activity?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ activity: res.data });
    },
  },

  accounting_ops_summary: {
    description: '[Accounting Ops] Resumen contable — ingresos, gastos y balance neto por periodo.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional)' },
        end_date: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.start_date) params.set('startDate', args.start_date);
      if (args.end_date) params.set('endDate', args.end_date);
      const res = await api.get(`/accounting/summary?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ summary: res.data });
    },
  },

  accounting_ops_profit: {
    description: '[Accounting Ops] Resumen de utilidad por origen — ingresos vs gastos desglosados por venta, envío, devolución.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        start_date: { type: 'string', description: 'Fecha inicio YYYY-MM-DD (opcional)' },
        end_date: { type: 'string', description: 'Fecha fin YYYY-MM-DD (opcional)' },
      },
    },
    handler: async (args: any) => {
      const params = new URLSearchParams();
      if (args.start_date) params.set('startDate', args.start_date);
      if (args.end_date) params.set('endDate', args.end_date);
      const res = await api.get(`/accounting/profit?${params.toString()}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ profit: res.data });
    },
  },

  accounting_ops_insights: {
    description: '[Accounting Ops] Insights contables — tendencias mensuales y orígenes principales de ingreso.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async (args: any) => {
      const res = await api.get('/accounting/insights');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ insights: res.data });
    },
  },

};
