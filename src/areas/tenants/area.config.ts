import type { AreaDefinition } from '../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'tenants',
  name: 'Tenants',
  description:
    'Company-specific logic: flows, mappings (chart of accounts, aliases), external datasets, business rules and reports. Lives in storage/<company>/.',
  leadAgentId: 'tenant-ops',
  agentIds: ['tenant-ops'],
};
