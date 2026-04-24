import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'sales',
  name: 'Sales B2B',
  description: 'Go-to-market - buyer personas, propuesta de valor, objeciones, funnel de ventas y competidores.',
  role: 'lead',
  areaId: 'comercial',
  capabilities: ['persona-management', 'content-management', 'funnel-analysis', 'competitor-analysis'],
  toolPrefix: 'sales_',
};
