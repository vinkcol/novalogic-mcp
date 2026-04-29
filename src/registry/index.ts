import { readdirSync, statSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import type {
  ToolDefinition,
  AreaDefinition,
  AgentDefinition,
  LoadedArea,
  LoadedAgent,
  AreaLayer,
} from '../shared/types.js';

function toImportURL(filePath: string): string {
  return pathToFileURL(filePath).href;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const AREAS_DIR = join(__dirname, '..', 'areas');

const LAYERS: AreaLayer[] = ['app', 'platform', 'strategy'];

const LAYER_LABELS: Record<AreaLayer, string> = {
  app: 'App (Operaciones de negocio)',
  platform: 'Platform (Ingeniería y producto)',
  strategy: 'Strategy (Estrategia y crecimiento)',
};

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

  for (const layer of LAYERS) {
    const layerPath = join(AREAS_DIR, layer);
    const areaDirs = getDirs(layerPath);

    for (const areaDir of areaDirs) {
      const areaPath = join(layerPath, areaDir);
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
  }

  return { areas, allTools };
}

export function generateAgentsGuideFromAreas(
  areas: Record<string, LoadedArea>,
): string {
  let guide = '# Novalogic MCP — Áreas y Agentes\n\n';

  for (const layer of LAYERS) {
    const layerAreas = Object.values(areas).filter(
      (a) => a.config.layer === layer,
    );
    if (layerAreas.length === 0) continue;

    guide += `---\n## ${LAYER_LABELS[layer]}\n\n`;

    for (const area of layerAreas) {
      const { config } = area;
      guide += `### ${config.name}\n`;
      guide += `${config.description}\n\n`;

      const agents = Object.values(area.agents);
      const lead = agents.find((a) => a.config.role === 'lead');
      const specialists = agents.filter((a) => a.config.role === 'specialist');
      const ordered = lead ? [lead, ...specialists] : specialists;

      for (const agent of ordered) {
        const { config: ac, tools: agentTools } = agent;
        const roleTag = ac.role === 'lead' ? 'LEAD' : `→ ${ac.reportsTo}`;
        guide += `#### ${ac.name} [${roleTag}]\n`;
        guide += `${ac.description}\n`;

        const toolNames = Object.keys(agentTools);
        if (toolNames.length > 0) {
          guide += `**Tools:** ${toolNames.join(', ')}\n`;
        }
        guide += '\n';
      }
    }
  }

  return guide;
}
