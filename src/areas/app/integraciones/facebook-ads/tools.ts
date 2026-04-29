import { api } from '../../../../services/api-client.js';

type AnyRecord = Record<string, any>;

function err(message: string, details?: unknown) {
  return details === undefined ? { error: message } : { error: message, details };
}

function ok(data: AnyRecord, message?: string) {
  return message ? { success: true, message, ...data } : { success: true, ...data };
}

export const tools = {
  facebook_ads_get_authorize_url: {
    description:
      '[Facebook Ads] Generar la URL de autorización OAuth para conectar una cuenta de Facebook a la empresa. ' +
      'El usuario debe abrir esa URL en un browser, iniciar sesión en Facebook y aprobar los permisos (ads_read, ads_management, business_management). ' +
      'Una vez aprobado, Facebook redirige al backend y el token queda guardado automáticamente. ' +
      'Usar facebook_ads_get_status después para confirmar que quedó conectado.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: async (_args: AnyRecord) => {
      const res = await api.get(`/ads/facebook/authorize-url`);
      if (!res.ok) return err(`Error al generar URL de autorización: ${JSON.stringify(res.data)}`);
      return ok(
        { authorizeUrl: res.data.authorizeUrl },
        'Abre esta URL en un browser para conectar la cuenta de Facebook. Tras aprobar, el token queda guardado automáticamente.',
      );
    },
  },

  facebook_ads_disconnect: {
    description:
      '[Facebook Ads] Desconectar la cuenta de Facebook vinculada a la empresa. Revoca el token almacenado.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: async (_args: AnyRecord) => {
      const res = await api.del(`/ads/facebook/disconnect`);
      if (!res.ok) return err(`Error al desconectar: ${JSON.stringify(res.data)}`);
      return ok(res.data);
    },
  },

  facebook_ads_get_status: {
    description:
      '[Facebook Ads] Ver el estado de la conexión OAuth de Facebook para la empresa. Indica si hay una cuenta conectada, si el token está vigente o requiere reautorización.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: async (_args: AnyRecord) => {
      const res = await api.get(`/ads/facebook/status`);
      if (!res.ok) return err(`Error al obtener estado Facebook: ${JSON.stringify(res.data)}`);
      return ok({ status: res.data });
    },
  },

  facebook_ads_get_accounts: {
    description:
      '[Facebook Ads] Listar las cuentas publicitarias (ad accounts) conectadas a la cuenta de Facebook de la empresa.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
    handler: async (_args: AnyRecord) => {
      const res = await api.get(`/ads/facebook/accounts`);
      if (!res.ok) return err(`Error al listar cuentas publicitarias: ${JSON.stringify(res.data)}`);
      const accounts = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
      return ok({ accounts, count: accounts.length });
    },
  },

  facebook_ads_get_campaigns: {
    description:
      '[Facebook Ads] Listar campañas de una cuenta publicitaria. Incluye estado, objetivo, presupuesto diario/vitalicio y fechas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: {
          type: 'string',
          description: 'ID de la cuenta publicitaria (con o sin prefijo act_)',
        },
      },
      required: ['account_id'],
    },
    handler: async (args: AnyRecord) => {
      const res = await api.get(`/ads/facebook/accounts/${args.account_id}/campaigns`);
      if (!res.ok) return err(`Error al listar campañas: ${JSON.stringify(res.data)}`);
      const campaigns = Array.isArray(res.data) ? res.data : res.data?.data ?? [];
      return ok({ campaigns, count: campaigns.length });
    },
  },

  facebook_ads_create_campaign: {
    description:
      '[Facebook Ads] Crear una nueva campaña en una cuenta publicitaria de Facebook. La campaña se crea en estado PAUSED por defecto.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        account_id: {
          type: 'string',
          description: 'ID de la cuenta publicitaria (con o sin prefijo act_)',
        },
        name: {
          type: 'string',
          description: 'Nombre de la campaña',
        },
        objective: {
          type: 'string',
          enum: [
            'OUTCOME_AWARENESS',
            'OUTCOME_TRAFFIC',
            'OUTCOME_ENGAGEMENT',
            'OUTCOME_LEADS',
            'OUTCOME_APP_PROMOTION',
            'OUTCOME_SALES',
          ],
          description: 'Objetivo de la campaña',
        },
        status: {
          type: 'string',
          enum: ['ACTIVE', 'PAUSED'],
          description: 'Estado inicial (default: PAUSED)',
        },
        daily_budget: {
          type: 'number',
          description: 'Presupuesto diario en centavos (ej: 500 = $5.00)',
        },
        lifetime_budget: {
          type: 'number',
          description: 'Presupuesto total vitalicio en centavos',
        },
        start_time: {
          type: 'string',
          description: 'Fecha de inicio ISO 8601',
        },
        stop_time: {
          type: 'string',
          description: 'Fecha de fin ISO 8601',
        },
      },
      required: ['account_id', 'name', 'objective'],
    },
    handler: async (args: AnyRecord) => {
      const body: AnyRecord = {
        name: args.name,
        objective: args.objective,
      };
      if (args.status) body.status = args.status;
      if (args.daily_budget) body.dailyBudget = args.daily_budget;
      if (args.lifetime_budget) body.lifetimeBudget = args.lifetime_budget;
      if (args.start_time) body.startTime = args.start_time;
      if (args.stop_time) body.stopTime = args.stop_time;

      const res = await api.post(
        `/ads/facebook/accounts/${args.account_id}/campaigns`,
        body,
      );
      if (!res.ok) return err(`Error al crear campaña: ${JSON.stringify(res.data)}`);
      return ok({ campaign: res.data }, `Campaña "${args.name}" creada exitosamente`);
    },
  },

  facebook_ads_get_insights: {
    description:
      '[Facebook Ads] Obtener métricas de rendimiento de una campaña: impresiones, clics, gasto, alcance, CTR, CPC, CPP y frecuencia. Soporta filtro por rango de fechas.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: {
          type: 'string',
          description: 'ID de la campaña en Facebook',
        },
        date_from: {
          type: 'string',
          description: 'Fecha de inicio del periodo (YYYY-MM-DD)',
        },
        date_to: {
          type: 'string',
          description: 'Fecha de fin del periodo (YYYY-MM-DD)',
        },
        metrics: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Métricas a solicitar (default: impressions, clicks, spend, reach, ctr, cpc, cpp, frequency)',
        },
      },
      required: ['campaign_id'],
    },
    handler: async (args: AnyRecord) => {
      let path = `/ads/facebook/campaigns/${args.campaign_id}/insights`;
      const params: string[] = [];
      if (args.date_from) params.push(`dateFrom=${args.date_from}`);
      if (args.date_to) params.push(`dateTo=${args.date_to}`);
      if (args.metrics) params.push(`metrics=${args.metrics.join(',')}`);
      if (params.length) path += `?${params.join('&')}`;

      const res = await api.get(path);
      if (!res.ok) return err(`Error al obtener insights: ${JSON.stringify(res.data)}`);
      return ok({ insights: res.data });
    },
  },
};
