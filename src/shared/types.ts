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

/**
 * Layer separates concerns physically:
 * - app:      Tools that operate business data (sales, customers, inventory, etc.)
 * - platform: Tools that build/maintain the platform (engineering, QA, knowledge)
 * - strategy: Tools for business strategy and growth (pricing, content, scraping)
 */
export type AreaLayer = 'app' | 'platform' | 'strategy';

export interface AreaDefinition {
  id: string;
  name: string;
  description: string;
  layer: AreaLayer;
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
