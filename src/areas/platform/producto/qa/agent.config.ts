import type { AgentDefinition } from '../../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'qa',
  name: 'QA Engineer',
  description: 'Calidad — reporte de issues, convenciones, test flows de browser, suites y métricas de cobertura.',
  role: 'specialist',
  areaId: 'producto',
  reportsTo: 'pm',
  capabilities: ['issue-tracking', 'convention-checking', 'import-validation', 'entity-usage', 'test-flows', 'test-suites', 'test-reporting'],
  toolPrefix: 'qa_',
};
