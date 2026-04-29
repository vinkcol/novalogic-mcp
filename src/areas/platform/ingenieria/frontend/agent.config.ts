import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'frontend',
  name: 'Frontend Developer',
  description: 'Inspección de features React — componentes, rutas, rooms, store Redux y búsqueda de código.',
  role: 'specialist',
  areaId: 'ingenieria',
  reportsTo: 'architect',
  capabilities: ['feature-inspection', 'route-analysis', 'room-system', 'store-inspection', 'code-search', 'pattern-recording'],
  toolPrefix: 'frontend_',
};
