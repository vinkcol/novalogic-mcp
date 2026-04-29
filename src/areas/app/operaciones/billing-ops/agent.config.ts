import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'billing-ops',
  name: 'Billing Ops',
  description: 'Gestión de facturación, wallet, transacciones y ciclos de cobro vía API interna.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['wallet-management', 'invoice-management', 'billing-cycle', 'balance-check'],
  toolPrefix: 'billing_ops_',
};
