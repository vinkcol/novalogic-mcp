import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'prospector',
  name: 'Prospector',
  description: 'Motor de prospección multifuente — gestiona campañas de scraping, ejecuta discovery, normaliza hallazgos, resuelve identidad, enriquece y sincroniza con CRM Directorio.',
  role: 'lead',
  areaId: 'scraping',
  capabilities: [
    'campaign-management',
    'multi-source-discovery',
    'extraction',
    'normalization',
    'identity-resolution',
    'idempotency',
    'enrichment',
    'crm-sync',
    'observability',
  ],
  toolPrefix: 'scraping_',
};
