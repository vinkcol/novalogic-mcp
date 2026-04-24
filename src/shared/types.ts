// ─── Tool Definition ──────────────────────────────────────────
export interface ToolDefinition {
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: any) => Promise<any>;
}

// ─── Agent Hierarchy ──────────────────────────────────────────
export type AgentRole = 'lead' | 'specialist';

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  role: AgentRole;
  areaId: string;
  reportsTo?: string;
  capabilities: string[];
  toolPrefix: string;
}

// ─── Area Definition ──────────────────────────────────────────
export interface AreaDefinition {
  id: string;
  name: string;
  description: string;
  leadAgentId: string;
  agentIds: string[];
  dependencies?: string[];
}

// ─── Registry Types ───────────────────────────────────────────
export interface LoadedAgent {
  config: AgentDefinition;
  tools: Record<string, ToolDefinition>;
}

export interface LoadedArea {
  config: AreaDefinition;
  agents: Record<string, LoadedAgent>;
}
