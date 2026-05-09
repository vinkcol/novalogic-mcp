import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'event-bus-agent',
  name: 'Event Bus',
  description:
    'Gestión del bus de eventos Redis Streams: publicación, suscripción, historial y dead letter queue.',
  role: 'specialist',
  reportsTo: 'orchestrator',
  areaId: 'orquestacion',
  capabilities: [
    'event-publishing',
    'event-subscription',
    'event-history',
    'dead-letter-queue',
  ],
  toolPrefix: 'events_',
};
