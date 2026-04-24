import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'strategist',
  name: 'Cyrus (Strategist)',
  description: 'Market architect. Manages growth strategy, positioning, tactical marketing, and ecosystem expansion.',
  role: 'specialist',
  areaId: 'business',
  capabilities: ['market-analysis', 'growth-strategy', 'marketing-tactics', 'competitive-positioning'],
  toolPrefix: 'business_strategist_',
};
