import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'controller',
  name: 'Cassius (Controller)',
  description: 'Guardian of financial precision. Manages profitability, cash flow, financial auditing, and cost control.',
  role: 'lead',
  areaId: 'business',
  capabilities: ['financial-auditing', 'cost-control', 'profitability-analysis', 'cash-flow-management'],
  toolPrefix: 'business_controller_',
};
