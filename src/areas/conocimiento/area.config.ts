import type { AreaDefinition } from '../../shared/types.js';

export const areaConfig: AreaDefinition = {
  id: 'conocimiento',
  name: 'Conocimiento',
  description:
    'Gestion de memoria semantica, contexto transversal y deliberacion multiagente para el proyecto.',
  leadAgentId: 'librarian',
  agentIds: ['librarian', 'concejo', 'sessions'],
};
