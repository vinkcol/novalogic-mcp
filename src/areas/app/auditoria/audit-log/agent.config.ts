import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'audit-log',
  name: 'Audit Log',
  description:
    'Manages audit findings — data quality issues, reconciliation anomalies, ETL errors and architectural decisions — scoped by tenant slug. Supports add, list, search, update (status/resolution) and summary reporting.',
  role: 'lead',
  areaId: 'auditoria',
  capabilities: [
    'audit-findings',
    'data-quality-log',
    'reconciliation-log',
    'etl-log',
    'decision-log',
  ],
  toolPrefix: 'audit_log_',
};
