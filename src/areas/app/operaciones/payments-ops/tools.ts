/**
 * Payments Ops Agent — Gateway configuration via Internal API
 */

import { api } from '../../../../services/api-client.js';

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

export const tools = {

  payments_ops_gateway_list: {
    description: '[Payments Ops] Listar gateways de pago configurados para la empresa activa.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async (_args: any) => {
      const res = await api.get('/payments/gateway-config');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ gateways: res.data });
    },
  },

  payments_ops_gateway_get_active: {
    description: '[Payments Ops] Obtener la configuración activa de un gateway específico (ej: wompi).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gateway: { type: 'string', description: 'Nombre del gateway (wompi, addi, sistecredito)' },
      },
    },
    handler: async (args: any) => {
      const qs = args.gateway ? `?gateway=${args.gateway}` : '';
      const res = await api.get(`/payments/gateway-config/active${qs}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ config: res.data });
    },
  },

  payments_ops_gateway_save: {
    description: '[Payments Ops] Crear o actualizar la configuración de un gateway de pago (llaves, modo test, estado).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gateway: { type: 'string', description: 'Nombre del gateway: wompi, addi, sistecredito' },
        public_key: { type: 'string', description: 'Llave pública del gateway' },
        private_key: { type: 'string', description: 'Llave privada del gateway' },
        webhook_secret: { type: 'string', description: 'Secreto para validación de webhooks (opcional)' },
        test_mode: { type: 'boolean', description: 'Modo sandbox/test (default: true)' },
        is_active: { type: 'boolean', description: 'Activar gateway (default: true)' },
      },
      required: ['gateway'],
    },
    handler: async (args: any) => {
      const body: any = { gateway: args.gateway };
      if (args.public_key) body.publicKey = args.public_key;
      if (args.private_key) body.privateKey = args.private_key;
      if (args.webhook_secret) body.webhookSecret = args.webhook_secret;
      if (args.test_mode !== undefined) body.testMode = args.test_mode;
      if (args.is_active !== undefined) body.isActive = args.is_active;

      const res = await api.post('/payments/gateway-config', body);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ config: res.data }, `Gateway ${args.gateway} configurado correctamente`);
    },
  },

  payments_ops_gateway_delete: {
    description: '[Payments Ops] Eliminar la configuración de un gateway de pago.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        gateway: { type: 'string', description: 'Nombre del gateway a eliminar (wompi, addi, sistecredito)' },
      },
      required: ['gateway'],
    },
    handler: async (args: any) => {
      const res = await api.del(`/payments/gateway-config/${args.gateway}`);
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({}, `Gateway ${args.gateway} eliminado`);
    },
  },

};
