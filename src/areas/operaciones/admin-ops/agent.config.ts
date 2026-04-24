import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'admin-ops',
  name: 'Admin Ops',
  description: 'Gestión de empresas, suscripciones, planes y addons vía API interna (SYSTEM_ADMIN scope).',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['company-management', 'subscription-management', 'plan-management', 'addon-management'],
  toolPrefix: 'admin_ops_',
};
