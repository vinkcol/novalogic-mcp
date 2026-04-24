import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'accounting-ops',
  name: 'Accounting Ops',
  description: 'Conciliación de cuentas, actividad de entregas, resumen contable y utilidad vía API interna.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['accounting-summary', 'profit-analysis', 'delivery-activity', 'reconciliation'],
  toolPrefix: 'accounting_ops_',
};
