import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'uxui',
  name: 'UX/UI Designer',
  description: 'Design system — tokens, guías de componentes, layouts, accesibilidad WCAG 2.1 AA.',
  role: 'specialist',
  areaId: 'producto',
  reportsTo: 'pm',
  capabilities: ['design-tokens', 'component-guides', 'layout-patterns', 'accessibility-checks'],
  toolPrefix: 'uxui_',
};
