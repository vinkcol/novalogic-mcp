import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'internal-audit',
  name: 'Internal Audit',
  description:
    'Consulta el log de auditoría de la Internal API (security.internal_audit_logs). ' +
    'Permite buscar operaciones por recurso/URL, método HTTP, resultado y rango de fechas. ' +
    'Útil para verificar trazabilidad, responsable y timestamp de cualquier cambio de datos.',
  role: 'specialist',
  areaId: 'auditoria',
  capabilities: ['internal-api-audit', 'operations-traceability', 'compliance-queries'],
  toolPrefix: 'internal_audit_',
};
