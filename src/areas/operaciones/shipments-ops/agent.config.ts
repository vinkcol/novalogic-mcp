import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'shipments-ops',
  name: 'Shipments Ops',
  description: 'Gestión de envíos, tracking, rutas de entrega y estadísticas vía API interna.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['shipment-crud', 'shipment-tracking', 'delivery-routes', 'shipping-stats'],
  toolPrefix: 'shipments_ops_',
};
