import type { AreaDefinition } from '../../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'integraciones',
  layer: 'app',
  name: 'Integraciones',
  description: 'Conectores con plataformas externas: Shopify, Facebook Ads, WooCommerce, Mercado Libre, etc.',
  leadAgentId: 'shopify',
  agentIds: ['shopify', 'facebook-ads'],
  dependencies: ['operaciones'],
};
