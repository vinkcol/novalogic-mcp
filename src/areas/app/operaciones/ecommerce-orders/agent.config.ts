import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'ecommerce-orders',
  name: 'Ecommerce Orders',
  description:
    'Lectura de órdenes originadas en tienda virtual (origin=ECOMMERCE). Las órdenes viven en el mismo pool que las ventas POS.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['ecommerce-orders-read', 'ecommerce-orders-filter'],
  toolPrefix: 'ecommerce_orders_',
};
