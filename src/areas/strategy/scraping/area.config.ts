import type { AreaDefinition } from '../../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'scraping',
  layer: 'strategy',
  name: 'Scraping',
  description: 'Motor de prospección multifuente — discovery, extracción, normalización, enriquecimiento, idempotencia y sincronización controlada a CRM Directorio.',
  leadAgentId: 'prospector',
  agentIds: ['prospector'],
  dependencies: ['comercial'],
};
