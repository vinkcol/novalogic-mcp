import type { AreaDefinition } from '../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'producto',
  name: 'Producto',
  description: 'Define, valida y diseña el producto — backlog, calidad, experiencia de usuario.',
  leadAgentId: 'pm',
  agentIds: ['pm', 'qa', 'uxui'],
  dependencies: ['ingenieria', 'conocimiento'],
};
