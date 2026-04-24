import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'devops',
  name: 'DevOps Engineer',
  description: 'Infraestructura y deployment — Docker, databases, Nginx, puertos, logs y health checks.',
  role: 'specialist',
  areaId: 'ingenieria',
  reportsTo: 'architect',
  capabilities: ['infra-overview', 'docker-management', 'port-scanning', 'health-check', 'log-inspection', 'db-info', 'nginx-config'],
  toolPrefix: 'devops_',
};
