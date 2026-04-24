import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'pricing',
  name: 'Pricing',
  description: 'Empaquetado comercial - planes, add-ons, comparativos y experimentos de precio.',
  role: 'specialist',
  areaId: 'comercial',
  reportsTo: 'sales',
  capabilities: ['pricing-management', 'packaging-design', 'plan-comparison', 'pricing-experiments'],
  toolPrefix: 'pricing_',
};
