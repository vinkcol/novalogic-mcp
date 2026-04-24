import type { AreaDefinition } from '../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'analytics',
  name: 'Analytics',
  description:
    'Analytical data warehouse (simora_v2 schema). ETL orchestration, financial summaries, ' +
    'and data quality checks across all sources: legacy MongoDB, Novalogic operational DB, OneDrive files. ' +
    'Reusable across companies — scope via company_slug.',
  leadAgentId: 'analytics-ops',
  agentIds: ['analytics-ops'],
};
