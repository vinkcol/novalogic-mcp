import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'backups',
  name: 'Backups',
  description:
    'Orquesta backups pg_dump del API remoto/local: creación, listado, descarga y borrado vía endpoints internos. Para restore en local usa el script scripts/restore-local.sh.',
  role: 'specialist',
  areaId: 'ingenieria',
  capabilities: [
    'backup-create',
    'backup-list',
    'backup-pull',
    'backup-delete',
  ],
  toolPrefix: 'backup_ops_',
};
