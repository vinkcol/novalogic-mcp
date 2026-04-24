import type { AreaDefinition } from '../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'comercial',
  name: 'Comercial',
  description: 'Vende y posiciona el producto - personas, pricing, contenido, SEO, acquisition y funnel de ventas.',
  leadAgentId: 'sales',
  agentIds: ['sales', 'content-seo', 'pricing', 'growth'],
  dependencies: ['producto'],
};
