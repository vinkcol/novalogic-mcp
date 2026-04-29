import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'tenant-ops',
  name: 'Tenant Ops',
  description:
    'Manages per-company logic — flows, mappings, datasets, rules and reports under storage/<company>/.',
  role: 'lead',
  areaId: 'tenants',
  capabilities: [
    'tenant-flows',
    'tenant-mappings',
    'tenant-datasets',
    'tenant-rules',
    'tenant-reports',
  ],
  toolPrefix: 'tenant_',
};
