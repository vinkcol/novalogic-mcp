import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'payments-ops',
  name: 'Payments Ops',
  description: 'Gestión de gateways de pago (Wompi, Addi, Sistecredito) vía API interna.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['gateway-config', 'payment-methods'],
  toolPrefix: 'payments_ops_',
};
