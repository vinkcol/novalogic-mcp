import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'analyst',
  name: 'Octavius (Analyst)',
  description: 'Intelligence eye. Manages Business Intelligence (BI), operational KPIs, and data-driven decision making.',
  role: 'specialist',
  areaId: 'business',
  capabilities: ['bi-dashboards', 'kpi-tracking', 'data-analysis', 'executive-reporting'],
  toolPrefix: 'business_analyst_',
};
