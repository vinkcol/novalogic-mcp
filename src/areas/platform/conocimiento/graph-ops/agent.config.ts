import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'graph-ops',
  name: 'Graph Ops',
  description:
    'CRUD over structured graphs — knowledge graphs, topologies, dependency trees, folder trees. Backed by PostgreSQL tables graphs/graph_nodes/graph_edges.',
  role: 'specialist',
  areaId: 'conocimiento',
  reportsTo: 'librarian',
  capabilities: ['graphs', 'topology', 'trees', 'knowledge-graphs'],
  toolPrefix: 'graph_',
};
