import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'compliance',
  name: 'Justinian (Compliance)',
  description: 'Legal protector. Manages contracts, data sovereignty, terms of service, and regulatory risk mitigation.',
  role: 'specialist',
  areaId: 'business',
  capabilities: ['legal-risk-assessment', 'contract-management', 'regulatory-compliance', 'data-governance'],
  toolPrefix: 'business_compliance_',
};
