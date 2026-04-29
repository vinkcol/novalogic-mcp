import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'architect',
  name: 'Architect',
  description: 'Estructura del proyecto, decisiones arquitectónicas (ADR), análisis de módulos y dependencias.',
  role: 'lead',
  areaId: 'ingenieria',
  capabilities: ['project-overview', 'module-inspection', 'adr-management', 'pattern-documentation', 'placement-suggestion'],
  toolPrefix: 'arch_',
};
