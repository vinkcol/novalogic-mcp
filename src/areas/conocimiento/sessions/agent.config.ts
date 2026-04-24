import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'sessions',
  name: 'Session Manager',
  description: 'Gestión del ciclo de vida de sesiones de trabajo — inicio, recuperación, seguimiento de pendientes y cierre.',
  role: 'specialist',
  reportsTo: 'librarian',
  areaId: 'conocimiento',
  capabilities: ['session-tracking', 'context-recovery', 'pending-items', 'session-history'],
  toolPrefix: 'session_',
};
