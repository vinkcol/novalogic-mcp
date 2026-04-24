import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'sales-ops',
  name: 'Sales Ops',
  description: 'Gestión de ventas, POS, items, estados y estadísticas vía API interna.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['sales-crud', 'sales-status', 'pos-transactions', 'sales-statistics'],
  toolPrefix: 'sales_ops_',
};
