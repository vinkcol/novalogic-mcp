import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'orchestrator',
  name: 'Orchestrator',
  description:
    'Lead de orquestación: workflows DAG, delegación de tareas via queue, protocolo de comunicación inter-agente, agent cards y discovery.',
  role: 'lead',
  areaId: 'orquestacion',
  capabilities: [
    'workflow-management',
    'task-delegation',
    'agent-messaging',
    'agent-discovery',
    'dag-execution',
  ],
  toolPrefix: 'orch_',
};
