import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'browser',
  name: 'Browser Agent',
  description: 'Automatización de browser — navegación, interacción, screenshots, OCR y ejecución de flujos de prueba.',
  role: 'specialist',
  areaId: 'operaciones',
  reportsTo: 'logistics',
  capabilities: ['browser-session', 'navigation', 'interaction', 'screenshots', 'ocr', 'flow-execution'],
  toolPrefix: 'browser_',
};
