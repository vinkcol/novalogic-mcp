import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'inventory-ops',
  name: 'Inventory Ops',
  description: 'Gestión de inventario, stock, ajustes y movimientos vía API interna.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['inventory-crud', 'stock-adjustment', 'stock-movements', 'categories'],
  toolPrefix: 'inventory_ops_',
};
