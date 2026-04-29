import type { AreaDefinition } from '../../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'operaciones',
  layer: 'app',
  name: 'Operaciones',
  description: 'Gestión logística, zonas de cobertura, carriers y automatización de pruebas operativas.',
  leadAgentId: 'logistics',
  agentIds: ['logistics', 'browser', 'sales-ops', 'customers-ops', 'products-ops', 'shipments-ops', 'admin-ops', 'billing-ops', 'inventory-ops', 'accounting-ops', 'ecommerce-sites', 'ecommerce-orders', 'ecommerce-offers', 'ecommerce-discount-codes', 'staff-ops', 'email-ops'],
  dependencies: ['ingenieria'],
};
