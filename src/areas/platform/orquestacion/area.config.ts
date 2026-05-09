import type { AreaDefinition } from '../../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'orquestacion',
  layer: 'platform',
  name: 'Orquestación',
  description:
    'Motor de orquestación multi-agente: event bus, task queue, workflows, protocolo inter-agente y observabilidad.',
  leadAgentId: 'orchestrator',
  agentIds: ['orchestrator', 'event-bus-agent', 'observability-agent'],
  dependencies: ['conocimiento', 'ingenieria'],
};
