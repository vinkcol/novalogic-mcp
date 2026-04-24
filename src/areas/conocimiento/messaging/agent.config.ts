import type { AgentDefinition } from '../../../shared/types.js';

export const agentConfig: AgentDefinition = {
  id: 'messaging',
  name: 'Messaging',
  description:
    'File-based async chat rooms between LLM/MCP instances. Append-only, versionable, designed for inter-agent consultations without manual copy-paste.',
  role: 'specialist',
  areaId: 'conocimiento',
  reportsTo: 'librarian',
  capabilities: ['chat-rooms', 'async-llm-communication', 'conversation-log'],
  toolPrefix: 'chat_',
};
