import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'facebook-ads',
  name: 'Facebook Ads',
  description: 'Integración con Facebook Marketing API — cuentas publicitarias, campañas, creación de campañas y métricas de rendimiento (impresiones, clics, gasto, CTR).',
  role: 'specialist',
  areaId: 'integraciones',
  capabilities: [
    'facebook-connection-status',
    'facebook-ad-accounts',
    'facebook-campaigns',
    'facebook-insights',
  ],
  toolPrefix: 'facebook_ads_',
};
