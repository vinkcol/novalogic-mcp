import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'ecommerce-discount-codes',
  name: 'Ecommerce Discount Codes',
  description:
    'Gestión de códigos de descuento/cupones de la tienda virtual. CRUD + asignación de productos/colecciones, límites de uso, validez por fecha.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['ecommerce-discount-codes-crud', 'ecommerce-coupons-scoping'],
  toolPrefix: 'ecommerce_discount_codes_',
};
