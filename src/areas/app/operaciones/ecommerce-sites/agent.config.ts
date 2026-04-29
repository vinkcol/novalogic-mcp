import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'ecommerce-sites',
  name: 'Ecommerce Sites',
  description: 'Gestión de tienda virtual: sitios, productos ecommerce y colecciones (agrupaciones de productos).',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['ecommerce-sites-crud', 'ecommerce-sites-stats', 'ecommerce-products-crud', 'ecommerce-collections-crud'],
  toolPrefix: 'ecommerce_sites_',
};
