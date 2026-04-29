import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'concejo',
  name: 'Concejo',
  description:
    'Mesa multiagente para deliberar problemas especificos con perspectivas de conocimiento, ingenieria, producto, comercial y operaciones.',
  role: 'specialist',
  areaId: 'conocimiento',
  reportsTo: 'librarian',
  capabilities: [
    'multi-agent-deliberation',
    'cross-functional-planning',
    'integrated-risk-analysis',
    'decision-framing',
  ],
  toolPrefix: 'council_',
};
