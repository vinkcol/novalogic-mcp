import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'pm',
  name: 'Project Manager',
  description: 'Gestión de backlog, sprints, tareas, priorización y métricas del proyecto.',
  role: 'lead',
  areaId: 'producto',
  capabilities: ['task-management', 'sprint-management', 'backlog-prioritization', 'metrics-dashboard'],
  toolPrefix: 'pm_',
};
