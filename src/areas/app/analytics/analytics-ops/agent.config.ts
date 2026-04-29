import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'analytics-ops',
  name: 'Analytics Ops',
  description:
    'Manages the simora_v2 analytical schema: ETL runs, financial summaries, table health checks, ' +
    'and audit script execution via the tenant Python engine.',
  role: 'specialist',
  areaId: 'analytics',
  toolPrefix: 'analytics',
  capabilities: [
    'etl-orchestration',
    'financial-summary',
    'data-upsert',
    'table-health',
  ],
};
