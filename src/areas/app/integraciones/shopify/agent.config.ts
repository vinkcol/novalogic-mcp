import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'shopify',
  name: 'Shopify Integration',
  description: 'Integración con Shopify Admin API — productos, órdenes, clientes, inventario, colecciones y fulfillments.',
  role: 'lead',
  areaId: 'integraciones',
  capabilities: [
    'shopify-products',
    'shopify-orders',
    'shopify-customers',
    'shopify-inventory',
    'shopify-collections',
    'shopify-fulfillments',
  ],
  toolPrefix: 'shopify_',
};
