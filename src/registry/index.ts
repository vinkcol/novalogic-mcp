import { readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type {
  ToolDefinition,
  AreaDefinition,
  AgentDefinition,
  LoadedArea,
  LoadedAgent,
} from '../shared/types.js';

function toImportURL(filePath: string): string {
  return pathToFileURL(filePath).href;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const AREAS_DIR = join(__dirname, '..', 'areas');

function getDirs(path: string): string[] {
  try {
    return readdirSync(path).filter((entry) => {
      try {
        return statSync(join(path, entry)).isDirectory();
      } catch {
        return false;
      }
    });
  } catch {
    return [];
  }
}

export async function loadAllAreas(): Promise<{
  areas: Record<string, LoadedArea>;
  allTools: Record<string, ToolDefinition>;
}> {
  const areas: Record<string, LoadedArea> = {};
  const allTools: Record<string, ToolDefinition> = {};

  const areaDirs = getDirs(AREAS_DIR);

  for (const areaDir of areaDirs) {
    const areaPath = join(AREAS_DIR, areaDir);
    const areaConfigPath = join(areaPath, 'area.config.js');

    if (!existsSync(areaConfigPath)) continue;

    const { areaConfig } = (await import(toImportURL(areaConfigPath))) as {
      areaConfig: AreaDefinition;
    };

    const loadedArea: LoadedArea = { config: areaConfig, agents: {} };

    const agentDirs = getDirs(areaPath).filter((dir) =>
      existsSync(join(areaPath, dir, 'agent.config.js')),
    );

    for (const agentDir of agentDirs) {
      const agentPath = join(areaPath, agentDir);

      const { agentConfig } = (await import(
        toImportURL(join(agentPath, 'agent.config.js'))
      )) as { agentConfig: AgentDefinition };

      const toolsModule = await import(toImportURL(join(agentPath, 'tools.js')));
      const agentTools: Record<string, ToolDefinition> =
        toolsModule.tools || toolsModule.default || {};

      loadedArea.agents[agentConfig.id] = {
        config: agentConfig,
        tools: agentTools,
      };

      Object.assign(allTools, agentTools);
    }

    areas[areaConfig.id] = loadedArea;
  }

  return { areas, allTools };
}

export function generateAgentsGuideFromAreas(
  areas: Record<string, LoadedArea>,
): string {
  let guide = '# Novalogic MCP — Áreas y Agentes\n\n';

  const areaOrder = [
    'conocimiento',
    'ingenieria',
    'business',
    'producto',
    'comercial',
    'operaciones',
  ];

  for (const areaId of areaOrder) {
    const area = areas[areaId];
    if (!area) continue;

    const { config } = area;
    guide += `## ${config.name}\n`;
    guide += `${config.description}\n\n`;

    // Lead first, then specialists
    const agents = Object.values(area.agents);
    const lead = agents.find((a) => a.config.role === 'lead');
    const specialists = agents.filter((a) => a.config.role === 'specialist');

    const ordered = lead ? [lead, ...specialists] : specialists;

    for (const agent of ordered) {
      const { config: ac, tools: agentTools } = agent;
      const roleTag = ac.role === 'lead' ? 'LEAD' : `→ ${ac.reportsTo}`;
      guide += `### ${ac.name} [${roleTag}]\n`;
      guide += `${ac.description}\n`;

      const toolNames = Object.keys(agentTools);
      if (toolNames.length > 0) {
        guide += `**Tools:** ${toolNames.join(', ')}\n`;
      }
      guide += '\n';
    }
  }

  return guide;
}
