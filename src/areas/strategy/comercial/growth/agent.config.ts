import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'growth',
  name: 'Growth',
  description: 'Adquisicion y conversion - canales, performance de landing, funnels y experimentacion.',
  role: 'specialist',
  areaId: 'comercial',
  reportsTo: 'sales',
  capabilities: ['channel-analysis', 'landing-performance', 'funnel-analysis', 'growth-experiments'],
  toolPrefix: 'growth_',
};
