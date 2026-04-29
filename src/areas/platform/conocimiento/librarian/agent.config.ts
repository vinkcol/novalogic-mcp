import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'librarian',
  name: 'Librarian',
  description: 'Memoria semántica del proyecto — almacena, busca y gestiona conocimiento con embeddings vectoriales.',
  role: 'lead',
  areaId: 'conocimiento',
  capabilities: ['memory-store', 'semantic-search', 'memory-management', 'knowledge-stats', 'business-process-modeling'],
  toolPrefix: 'memory_',
};
