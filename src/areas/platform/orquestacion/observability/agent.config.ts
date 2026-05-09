import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'observability-agent',
  name: 'Observability',
  description:
    'Trazabilidad distribuida, métricas time-series y health dashboard del sistema multi-agente.',
  role: 'specialist',
  reportsTo: 'orchestrator',
  areaId: 'orquestacion',
  capabilities: [
    'distributed-tracing',
    'metrics-collection',
    'health-monitoring',
    'agent-status',
  ],
  toolPrefix: 'obs_',
};
