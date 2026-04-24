import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'content-seo',
  name: 'Content & SEO',
  description: 'Gestión de páginas, copy variants, meta tags, structured data y scoring SEO.',
  role: 'specialist',
  areaId: 'comercial',
  reportsTo: 'sales',
  capabilities: ['page-management', 'copy-variants', 'seo-config', 'seo-scoring'],
  toolPrefix: 'content_',
};
