/**
 * Billing Ops Agent — Invoices, Wallet & Billing Cycle via Internal API
 */

import { api } from '../../../../services/api-client.js';

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

export const tools = {

  // ──── Wallet ────────────────────────────────────────────────────────────

  billing_ops_wallet_balance: {
    description: '[Billing Ops] Consultar saldo del wallet de una empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string', description: 'UUID de la empresa' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/billing/wallet/${args.company_id}/balance`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ wallet: res.data });
    },
  },

  billing_ops_transactions: {
    description: '[Billing Ops] Listar transacciones del wallet de una empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string', description: 'UUID de la empresa' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/billing/wallet/${args.company_id}/transactions`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ transactions: res.data });
    },
  },

  billing_ops_topup: {
    description: '[Billing Ops] Recargar saldo al wallet de una empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'string', description: 'UUID de la empresa' },
        amount: { type: 'number', description: 'Monto a recargar (COP)' },
        description: { type: 'string', description: 'Descripcion de la recarga' },
      },
      required: ['company_id', 'amount'],
    },
    handler: async (args: any) => {
      const res = await api.post('/billing/wallet/topup', {
        companyId: args.company_id,
        amount: args.amount,
        description: args.description || 'Recarga via MCP',
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ result: res.data }, `Wallet recargado: $${args.amount} COP`);
    },
  },

  billing_ops_check_balance: {
    description: '[Billing Ops] Verificar si empresa tiene saldo suficiente.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'string' },
        amount: { type: 'number', description: 'Monto requerido' },
      },
      required: ['company_id', 'amount'],
    },
    handler: async (args: any) => {
      const res = await api.post('/billing/wallet/check-balance', {
        companyId: args.company_id,
        amount: args.amount,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ result: res.data });
    },
  },

  // ──── Invoices ──────────────────────────────────────────────────────────

  billing_ops_list_invoices: {
    description: '[Billing Ops] Listar todas las facturas.',
    inputSchema: { type: 'object' as const, properties: {} },
    handler: async () => {
      const res = await api.get('/billing/invoices');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ invoices: res.data });
    },
  },

  billing_ops_company_invoices: {
    description: '[Billing Ops] Listar facturas de una empresa especifica.',
    inputSchema: {
      type: 'object' as const,
      properties: { company_id: { type: 'string' } },
      required: ['company_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/billing/invoices/company/${args.company_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ invoices: res.data });
    },
  },

  billing_ops_get_invoice: {
    description: '[Billing Ops] Obtener detalle de una factura por ID.',
    inputSchema: {
      type: 'object' as const,
      properties: { invoice_id: { type: 'string' } },
      required: ['invoice_id'],
    },
    handler: async (args: any) => {
      const res = await api.get(`/billing/invoices/${args.invoice_id}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ invoice: res.data });
    },
  },

  billing_ops_generate_invoice: {
    description: '[Billing Ops] Generar factura con items (IVA 19% automatico).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'string', description: 'UUID de la empresa' },
        items: {
          type: 'array',
          description: 'Items de la factura',
          items: {
            type: 'object',
            properties: {
              description: { type: 'string' },
              quantity: { type: 'number' },
              unit_price: { type: 'number' },
            },
          },
        },
      },
      required: ['company_id', 'items'],
    },
    handler: async (args: any) => {
      const res = await api.post('/billing/invoices/generate', {
        companyId: args.company_id,
        items: args.items?.map((i: any) => ({
          description: i.description,
          quantity: i.quantity,
          unitPrice: i.unit_price,
        })),
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ invoice: res.data }, 'Factura generada');
    },
  },

  billing_ops_generate_subscription_invoice: {
    description: '[Billing Ops] Generar factura de renovacion de suscripcion.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        company_id: { type: 'string' },
        plan_name: { type: 'string', description: 'Nombre del plan' },
        monthly_price: { type: 'number', description: 'Precio mensual' },
      },
      required: ['company_id', 'plan_name', 'monthly_price'],
    },
    handler: async (args: any) => {
      const res = await api.post('/billing/invoices/generate-subscription', {
        companyId: args.company_id,
        planName: args.plan_name,
        monthlyPrice: args.monthly_price,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ invoice: res.data }, 'Factura de suscripcion generada');
    },
  },

  billing_ops_pay_invoice: {
    description: '[Billing Ops] Marcar factura como pagada.',
    inputSchema: {
      type: 'object' as const,
      properties: { invoice_id: { type: 'string' } },
      required: ['invoice_id'],
    },
    handler: async (args: any) => {
      const res = await api.put(`/billing/invoices/${args.invoice_id}/pay`, {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ invoice: res.data }, 'Factura marcada como pagada');
    },
  },

  // ──── Billing Cycle ─────────────────────────────────────────────────────

  billing_ops_calculate_cycle: {
    description: '[Billing Ops] Calcular ciclo de facturacion de una suscripcion.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        subscription_id: { type: 'string' },
        plan_name: { type: 'string' },
        plan_level: { type: 'string' },
        monthly_price: { type: 'number' },
        is_trial: { type: 'boolean' },
        trial_end_date: { type: 'string' },
      },
      required: ['subscription_id'],
    },
    handler: async (args: any) => {
      const res = await api.post('/billing/billing-cycle/calculate', {
        subscriptionId: args.subscription_id,
        planName: args.plan_name,
        planLevel: args.plan_level,
        monthlyPrice: args.monthly_price,
        isTrial: args.is_trial,
        trialEndDate: args.trial_end_date,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ cycle: res.data });
    },
  },
};
