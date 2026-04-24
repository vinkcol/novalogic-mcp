/**
 * Prospector Agent — MCP Tools
 * Exposes scraping area functionality as MCP tools.
 */
import * as discovery from '../engines/discovery.engine.js';
import * as identity from '../engines/identity.engine.js';
import * as enrichment from '../engines/enrichment.engine.js';
import * as crmSync from '../engines/crm-sync.engine.js';
import * as observability from '../engines/observability.engine.js';
import * as orchestrator from '../engines/orchestrator.engine.js';
import * as promotion from '../engines/promotion.engine.js';
import { googleMapsConnector } from '../connectors/google-maps.connector.js';
import { paginasAmarillasConnector } from '../connectors/paginas-amarillas.connector.js';

// Register connectors on load
orchestrator.registerConnector(googleMapsConnector);
orchestrator.registerConnector(paginasAmarillasConnector);

export const tools = {
  // ══════════════════════════════════════════════════════════════
  // CAMPAIGNS
  // ══════════════════════════════════════════════════════════════

  scraping_create_campaign: {
    description: `[Prospector] Crea una campaña de scraping para descubrir negocios. Define fuente, geografía, categorías y queries de búsqueda. La campaña genera jobs idempotentes por cada combinación query×ciudad×página.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: 'Nombre descriptivo de la campaña' },
        source_id: { type: 'string', description: 'Conector fuente: google-maps, paginas-amarillas' },
        country: { type: 'string', description: 'País (default: Colombia)' },
        departments: { type: 'array', items: { type: 'string' }, description: 'Departamentos objetivo' },
        cities: { type: 'array', items: { type: 'string' }, description: 'Ciudades objetivo' },
        categories: { type: 'array', items: { type: 'string' }, description: 'Categorías de negocio' },
        queries: { type: 'array', items: { type: 'string' }, description: 'Términos de búsqueda' },
        priority: { type: 'number', description: '0=baja, 10=urgente (default: 5)' },
        max_pages: { type: 'number', description: 'Páginas máximas por query×ciudad (default: 3)' },
        recurring: { type: 'boolean', description: 'Si es true, la campaña se puede re-ejecutar en nuevos time windows (default: false)' },
      },
      required: ['name', 'source_id', 'cities', 'categories', 'queries'],
    },
    handler: async (args: any) => {
      const result = await discovery.createCampaign({
        name: args.name,
        sourceId: args.source_id,
        status: 'draft',
        geography: {
          country: args.country || 'Colombia',
          departments: args.departments || [''],
          cities: args.cities,
        },
        categories: args.categories,
        queries: args.queries,
        priority: args.priority ?? 5,
        maxPages: args.max_pages || 3,
        scheduling: { runOnce: !args.recurring },
        metadata: {},
      });
      return { success: true, campaignId: result.id, message: `Campaña '${args.name}' creada (id: ${result.id}). Usa scraping_run_campaign para ejecutarla.` };
    },
  },

  scraping_list_campaigns: {
    description: `[Prospector] Lista campañas de scraping con filtros opcionales por estado y fuente.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        status: { type: 'string', description: 'Filtrar: draft, active, paused, completed, failed' },
        source_id: { type: 'string', description: 'Filtrar por fuente' },
      },
    },
    handler: async (args: any) => {
      const campaigns = await discovery.listCampaigns({
        status: args.status,
        sourceId: args.source_id,
      });
      return { campaigns, count: campaigns.length };
    },
  },

  scraping_get_campaign: {
    description: `[Prospector] Obtiene detalle de una campaña por ID.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'ID de la campaña' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const campaign = await discovery.getCampaign(args.id);
      if (!campaign) return { error: `Campaña ${args.id} no encontrada` };
      return { campaign };
    },
  },

  // ══════════════════════════════════════════════════════════════
  // EXECUTION
  // ══════════════════════════════════════════════════════════════

  scraping_run_campaign: {
    description: `[Prospector] Ejecuta una campaña completa: genera jobs → lanza browser → extrae → normaliza → resuelve identidad → enriquece → sincroniza a CRM Directorio. Idempotente: re-ejecutar no duplica jobs ya completados. El browser se cierra automáticamente al terminar.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'ID de la campaña a ejecutar' },
        max_jobs: { type: 'number', description: 'Máximo de jobs a ejecutar (default: 50)' },
        skip_sync: { type: 'boolean', description: 'Saltar sincronización a CRM (default: false)' },
        skip_enrichment: { type: 'boolean', description: 'Saltar enriquecimiento (default: false)' },
      },
      required: ['campaign_id'],
    },
    handler: async (args: any) => {
      const result = await orchestrator.runCampaign(args.campaign_id, {
        maxJobs: args.max_jobs,
        skipSync: args.skip_sync,
        skipEnrichment: args.skip_enrichment,
      });
      return { success: true, ...result };
    },
  },

  scraping_replay_campaign: {
    description: `[Prospector] Re-intenta jobs fallidos de una campaña. Seguro: no reprocesa jobs exitosos gracias a idempotencia.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'ID de la campaña' },
      },
      required: ['campaign_id'],
    },
    handler: async (args: any) => {
      const result = await orchestrator.replayCampaign(args.campaign_id);
      return { success: true, ...result, message: `${result.retriedJobs} jobs re-encolados para reintento` };
    },
  },

  scraping_generate_jobs: {
    description: `[Prospector] Genera jobs pendientes para una campaña sin ejecutarlos. Útil para previsualizar cuántos jobs se crearán.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'ID de la campaña' },
      },
      required: ['campaign_id'],
    },
    handler: async (args: any) => {
      const result = await discovery.generateJobs(args.campaign_id);
      return { success: true, ...result, message: `${result.created} jobs creados, ${result.skipped} saltados (ya existían)` };
    },
  },

  // ══════════════════════════════════════════════════════════════
  // SCHEDULING
  // ══════════════════════════════════════════════════════════════

  scraping_due_campaigns: {
    description: `[Prospector] Lista campañas recurrentes que pueden ser re-ejecutadas en un nuevo time window. Solo muestra campañas no marcadas como runOnce.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      return orchestrator.getDueCampaigns();
    },
  },

  scraping_schedule_rerun: {
    description: `[Prospector] Re-activa una campaña completada para ejecutar en el time window actual. Genera nuevos jobs solo para combinaciones no vistas en esta semana.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        campaign_id: { type: 'number', description: 'ID de la campaña a re-activar' },
      },
      required: ['campaign_id'],
    },
    handler: async (args: any) => {
      return orchestrator.scheduleCampaignRerun(args.campaign_id);
    },
  },

  // ══════════════════════════════════════════════════════════════
  // PROSPECTS
  // ══════════════════════════════════════════════════════════════

  scraping_list_prospects: {
    description: `[Prospector] Lista prospectos descubiertos con filtros por ciudad, departamento, categoría y calidad mínima.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        city: { type: 'string', description: 'Filtrar por ciudad' },
        department: { type: 'string', description: 'Filtrar por departamento' },
        category: { type: 'string', description: 'Filtrar por categoría normalizada' },
        min_quality: { type: 'number', description: 'Calidad mínima 0-100 (default: 0)' },
        limit: { type: 'number', description: 'Límite (default: 50)' },
        offset: { type: 'number', description: 'Offset para paginación' },
      },
    },
    handler: async (args: any) => {
      return identity.listProspects({
        city: args.city,
        department: args.department,
        category: args.category,
        minQuality: args.min_quality,
        limit: args.limit,
        offset: args.offset,
      });
    },
  },

  scraping_get_prospect: {
    description: `[Prospector] Obtiene detalle completo de un prospecto por ID, incluyendo historial de enriquecimiento y sync.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        id: { type: 'number', description: 'ID del prospecto' },
      },
      required: ['id'],
    },
    handler: async (args: any) => {
      const prospect = await identity.getProspect(args.id);
      if (!prospect) return { error: `Prospecto ${args.id} no encontrado` };
      return { prospect };
    },
  },

  // ══════════════════════════════════════════════════════════════
  // ENRICHMENT
  // ══════════════════════════════════════════════════════════════

  scraping_enrich_prospect: {
    description: `[Prospector] Enriquece un prospecto: calcula quality score, ICP match y señales comerciales. Incremental — solo actualiza si hay cambios.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'number', description: 'ID del prospecto a enriquecer' },
      },
      required: ['prospect_id'],
    },
    handler: async (args: any) => {
      return enrichment.enrichProspect(args.prospect_id);
    },
  },

  scraping_enrich_batch: {
    description: `[Prospector] Enriquece prospectos pendientes en batch. Procesa los que aún no tienen enrichment o fueron actualizados después del último enrichment.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        limit: { type: 'number', description: 'Máximo a procesar (default: 100)' },
      },
    },
    handler: async (args: any) => {
      return enrichment.enrichBatch(args.limit);
    },
  },

  // ══════════════════════════════════════════════════════════════
  // CRM SYNC
  // ══════════════════════════════════════════════════════════════

  scraping_sync_prospect: {
    description: `[Prospector] Sincroniza un prospecto a CRM Directorio. Solo envía si hay cambio material (nuevo email, teléfono, dominio, mejora de score, etc.). Idempotente.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'number', description: 'ID del prospecto a sincronizar' },
      },
      required: ['prospect_id'],
    },
    handler: async (args: any) => {
      return crmSync.syncProspectToCrm(args.prospect_id);
    },
  },

  scraping_sync_batch: {
    description: `[Prospector] Sincroniza batch de prospectos a CRM Directorio. Solo incluye prospectos con calidad mínima y cambios materiales pendientes.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        min_quality: { type: 'number', description: 'Calidad mínima para sincronizar (default: 20)' },
        icp_match: { type: 'string', description: 'Filtrar por ICP: high, medium, low' },
        limit: { type: 'number', description: 'Máximo a sincronizar (default: 50)' },
      },
    },
    handler: async (args: any) => {
      return crmSync.syncBatchToCrm({
        minQuality: args.min_quality,
        icpMatch: args.icp_match,
        limit: args.limit,
      });
    },
  },

  // ══════════════════════════════════════════════════════════════
  // PROMOTION
  // ══════════════════════════════════════════════════════════════

  scraping_list_policies: {
    description: `[Prospector] Lista políticas de promoción disponibles para mover prospectos de CRM Directorio al funnel comercial. Políticas: conservative, standard, aggressive.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      return { policies: promotion.listPolicies() };
    },
  },

  scraping_evaluate_promotion: {
    description: `[Prospector] Evalúa qué prospectos son elegibles para promoción al funnel según una política. No promueve — solo evalúa. Usa scraping_promote_batch para ejecutar.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        policy_id: { type: 'string', description: 'ID de política: conservative, standard, aggressive' },
        limit: { type: 'number', description: 'Máximo a evaluar (default: 100)' },
      },
      required: ['policy_id'],
    },
    handler: async (args: any) => {
      return promotion.evaluateEligibility(args.policy_id, { limit: args.limit });
    },
  },

  scraping_promote_prospect: {
    description: `[Prospector] Promueve un prospecto específico de CRM Directorio al funnel comercial. Requiere que el prospecto ya esté sincronizado al CRM.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        prospect_id: { type: 'number', description: 'ID del prospecto a promover' },
      },
      required: ['prospect_id'],
    },
    handler: async (args: any) => {
      return promotion.promoteProspect(args.prospect_id);
    },
  },

  scraping_promote_batch: {
    description: `[Prospector] Promueve en batch prospectos elegibles según una política. Por defecto es dry_run=true (solo muestra qué se promovería). Pasar dry_run=false para ejecutar.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        policy_id: { type: 'string', description: 'ID de política: conservative, standard, aggressive' },
        limit: { type: 'number', description: 'Máximo a promover (default: 50)' },
        dry_run: { type: 'boolean', description: 'Solo evaluar sin promover (default: true)' },
      },
      required: ['policy_id'],
    },
    handler: async (args: any) => {
      return promotion.batchPromote(args.policy_id, {
        limit: args.limit,
        dryRun: args.dry_run ?? true,
      });
    },
  },

  // ══════════════════════════════════════════════════════════════
  // OBSERVABILITY
  // ══════════════════════════════════════════════════════════════

  scraping_dashboard: {
    description: `[Prospector] Dashboard completo del area de scraping: campañas, jobs, prospectos, sync y cobertura.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      return observability.getFullDashboard();
    },
  },

  scraping_coverage_report: {
    description: `[Prospector] Reporte de cobertura geográfica y por categoría — cuántos prospectos por ciudad, calidad promedio, ICP high count.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      return observability.getCoverageReport();
    },
  },

  scraping_job_stats: {
    description: `[Prospector] Estadísticas de jobs por fuente y campaña — éxito, fallos, promedios de hallazgos.`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        source_id: { type: 'string', description: 'Filtrar por fuente' },
        campaign_id: { type: 'number', description: 'Filtrar por campaña' },
        days: { type: 'number', description: 'Últimos N días (default: todos)' },
      },
    },
    handler: async (args: any) => {
      return observability.getJobStats({
        sourceId: args.source_id,
        campaignId: args.campaign_id,
        days: args.days,
      });
    },
  },

  scraping_sync_stats: {
    description: `[Prospector] Estadísticas de sincronización a CRM — created, updated, skipped, failed + errores recientes.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      return observability.getSyncStats();
    },
  },

  // ══════════════════════════════════════════════════════════════
  // CONNECTORS
  // ══════════════════════════════════════════════════════════════

  scraping_list_connectors: {
    description: `[Prospector] Lista conectores de fuente registrados y disponibles para campañas.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      const ids = orchestrator.listConnectors();
      return {
        connectors: ids.map((id) => {
          const c = orchestrator.getConnector(id);
          return { id, name: c?.sourceName, type: c?.sourceType };
        }),
        count: ids.length,
      };
    },
  },

  // ══════════════════════════════════════════════════════════════
  // SMOKE TEST
  // ══════════════════════════════════════════════════════════════

  scraping_smoke_test: {
    description: `[Prospector] Smoke test E2E del pipeline de scraping. Crea campaña mock → genera jobs → inserta hallazgos simulados → normaliza → resuelve identidad → enriquece → verifica sync readiness. NO usa browser ni sitios externos.`,
    inputSchema: {
      type: 'object' as const,
      properties: {},
    },
    handler: async () => {
      return orchestrator.runSmokeTest();
    },
  },
};
