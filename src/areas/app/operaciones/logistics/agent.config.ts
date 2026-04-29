import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'logistics',
  name: 'Logistics',
  description: 'Gestión de zonas, subzonas, carriers y cobertura logística vía API interna.',
  role: 'lead',
  areaId: 'operaciones',
  capabilities: ['zone-management', 'subzone-management', 'coverage-lookup', 'carrier-listing', 'zone-seeding'],
  toolPrefix: 'logistics_',
};
