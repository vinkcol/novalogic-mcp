import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'customers-ops',
  name: 'Customers Ops',
  description: 'Gestión de clientes, direcciones, búsqueda y estadísticas vía API interna.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['customers-crud', 'address-management', 'customer-search', 'customer-stats'],
  toolPrefix: 'customers_ops_',
};
