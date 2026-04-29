import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'diagnostics',
  name: 'Diagnostics',
  description:
    'Observabilidad en tiempo real: consulta errores 4xx/5xx capturados por el colector de telemetría, con request/response/stack completos y reproducción.',
  role: 'specialist',
  areaId: 'ingenieria',
  capabilities: [
    'error-search',
    'error-detail',
    'top-errors',
    'error-stats',
    'error-replay',
  ],
  toolPrefix: 'diag_',
};
