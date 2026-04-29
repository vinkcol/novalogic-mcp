import type { AreaDefinition } from '../../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'ingenieria',
  layer: 'platform',
  name: 'Ingeniería',
  description: 'Construye y mantiene el producto Novalogic — API, Dashboard, infraestructura y arquitectura.',
  leadAgentId: 'architect',
  agentIds: ['architect', 'backend', 'frontend', 'devops', 'diagnostics', 'backups'],
  dependencies: ['conocimiento'],
};
