import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'ecommerce-offers',
  name: 'Ecommerce Offers',
  description:
    'Gestión de ofertas/promociones de la tienda virtual (flash sales, seasonal, clearance). CRUD + asignación de productos/colecciones.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['ecommerce-offers-crud', 'ecommerce-offers-scoping'],
  toolPrefix: 'ecommerce_offers_',
};
