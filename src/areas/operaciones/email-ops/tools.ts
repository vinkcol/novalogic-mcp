/**
 * Email Ops Agent — SMTP config, test emails & custom emails via Internal API
 */

import { api } from '../../../services/api-client.js';

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

export const tools = {

  // ──── Config ───────────────────────────────────────────────────────────

  email_ops_config: {
    description: '[Email Ops] Ver configuración SMTP actual (host, puerto, usuario enmascarado, frontendUrl).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.get('/email/config');
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ config: res.data });
    },
  },

  // ──── Verify Connection ────────────────────────────────────────────────

  email_ops_verify: {
    description: '[Email Ops] Verificar conexión SMTP (intenta conectarse al servidor de correo).',
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const res = await api.post('/email/verify-connection', {});
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ result: res.data });
    },
  },

  // ──── Send Test ────────────────────────────────────────────────────────

  email_ops_send_test: {
    description: '[Email Ops] Enviar email de prueba para verificar que SMTP funciona.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Email destino para la prueba' },
      },
      required: ['to'],
    },
    handler: async (args: any) => {
      const res = await api.post('/email/send-test', { to: args.to });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ result: res.data });
    },
  },

  // ──── Send Custom ──────────────────────────────────────────────────────

  email_ops_send: {
    description: '[Email Ops] Enviar un email personalizado (HTML).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        to: { type: 'string', description: 'Email destino' },
        subject: { type: 'string', description: 'Asunto del email' },
        html: { type: 'string', description: 'Contenido HTML del email' },
      },
      required: ['to', 'subject', 'html'],
    },
    handler: async (args: any) => {
      const res = await api.post('/email/send', {
        to: args.to,
        subject: args.subject,
        html: args.html,
      });
      if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
      return ok({ result: res.data });
    },
  },

};
