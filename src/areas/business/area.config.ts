import type { AreaDefinition } from '../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'business',
  name: 'Business',
  description:
    'Administrative and strategic core: Financial control (CFO), market strategy, compliance, and business intelligence. Responsible for unit economics and high-level decision making.',
  leadAgentId: 'controller',
  agentIds: ['controller', 'strategist', 'compliance', 'analyst'],
};
