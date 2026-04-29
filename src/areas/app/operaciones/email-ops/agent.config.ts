import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'email-ops',
  name: 'Email Ops',
  description: 'Verificación de configuración SMTP, envío de emails de prueba y emails personalizados vía API interna.',
  role: 'specialist',
  areaId: 'operaciones',
  capabilities: ['email-config', 'email-send', 'email-test'],
  toolPrefix: 'email_ops_',
};
