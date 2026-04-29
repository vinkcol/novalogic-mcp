import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'products-ops',
  name: 'Products Ops',
  description: 'Gestión de productos, categorías, activación/desactivación vía API interna.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['products-crud', 'product-status', 'category-listing'],
  toolPrefix: 'products_ops_',
};
