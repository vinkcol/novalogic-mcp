import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'staff-ops',
  name: 'Staff Ops',
  description: 'Gestión de empleados vía Internal API: creación, consulta y actualización.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['employee-creation', 'employee-listing', 'employee-update'],
  toolPrefix: 'staff_ops_',
};
