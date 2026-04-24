import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'backend',
  name: 'Backend Developer',
  description: 'Inspección de módulos NestJS — controllers, services, entities, DTOs, endpoints y búsqueda de código.',
  role: 'specialist',
  areaId: 'ingenieria',
  reportsTo: 'architect',
  capabilities: ['module-inspection', 'endpoint-analysis', 'entity-inspection', 'code-search', 'pattern-recording'],
  toolPrefix: 'backend_',
};
