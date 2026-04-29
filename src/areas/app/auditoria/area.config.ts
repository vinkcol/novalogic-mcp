import type { AreaDefinition } from '../../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'auditoria',
  layer: 'app',
  name: 'Auditoría',
  description:
    'Registro persistente de hallazgos, anomalías y decisiones tomadas durante procesos de auditoría de datos. Bitácoras por tenant, con categorización, severidad y trazabilidad de resolución.',
  leadAgentId: 'audit-log',
  agentIds: ['audit-log', 'internal-audit'],
};
