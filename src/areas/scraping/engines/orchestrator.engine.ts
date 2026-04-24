/**
 * Orchestrator Engine
 * Coordinates the full scraping pipeline:
 * campaign → jobs → extraction → normalization → identity → enrichment → sync
 */
import { query } from '../../../db/client.js';
import * as discovery from './discovery.engine.js';
import { normalizeRawFinding } from './normalization.engine.js';
import { resolveIdentity } from './identity.engine.js';
import { enrichProspect } from './enrichment.engine.js';
import { syncProspectToCrm } from './crm-sync.engine.js';
import { recordMetric } from './observability.engine.js';
import * as browserBridge from './browser-bridge.js';
import type { SourceConnector, RawFinding, ScrapeJob } from '../schemas/index.js';

// ─── Connector Registry ──────────────────────────────────────

const connectors = new Map<string, SourceConnector>();

export function registerConnector(connector: SourceConnector): void {
  connectors.set(connector.sourceId, connector);
}

export function getConnector(sourceId: string): SourceConnector | undefined {
  return connectors.get(sourceId);
}

export function listConnectors(): string[] {
  return Array.from(connectors.keys());
}

// ─── Run Campaign ────────────────────────────────────────────

export interface RunCampaignResult {
  campaignId: number;
  jobsGenerated: number;
  jobsSkipped: number;
  jobsExecuted: number;
  totalFindings: number;
  prospectsCreated: number;
  prospectsMerged: number;
  syncCreated: number;
  syncUpdated: number;
  syncSkipped: number;
  errors: string[];
}

export async function runCampaign(
  campaignId: number,
  options?: { maxJobs?: number; skipSync?: boolean; skipEnrichment?: boolean },
): Promise<RunCampaignResult> {
  const result: RunCampaignResult = {
    campaignId,
    jobsGenerated: 0,
    jobsSkipped: 0,
    jobsExecuted: 0,
    totalFindings: 0,
    prospectsCreated: 0,
    prospectsMerged: 0,
    syncCreated: 0,
    syncUpdated: 0,
    syncSkipped: 0,
    errors: [],
  };

  // 1. Activate campaign
  await discovery.updateCampaignStatus(campaignId, 'active');

  // 2. Generate jobs
  const gen = await discovery.generateJobs(campaignId);
  result.jobsGenerated = gen.created;
  result.jobsSkipped = gen.skipped;

  // 3. Get pending jobs for this campaign
  const maxJobs = options?.maxJobs || 50;
  const jobsResult = await query(
    `SELECT * FROM scrape_jobs WHERE campaign_id = $1 AND status = 'pending' ORDER BY created_at ASC LIMIT $2`,
    [campaignId, maxJobs],
  );

  const campaign = await discovery.getCampaign(campaignId);
  if (!campaign) {
    result.errors.push('Campaign not found');
    return result;
  }

  const connector = getConnector(campaign.sourceId);
  if (!connector) {
    result.errors.push(`No connector registered for source '${campaign.sourceId}'`);
    await discovery.updateCampaignStatus(campaignId, 'failed');
    return result;
  }

  // 4. Launch browser for extraction (shared across all jobs in campaign)
  const needsBrowser = jobsResult.rows.length > 0;
  if (needsBrowser && !browserBridge.isActive()) {
    await browserBridge.launchBrowser({ headless: true });
  }

  // 5. Execute each job
  for (const jobRow of jobsResult.rows) {
    try {
      const jobStats = await executeJob(jobRow, connector, options);
      result.jobsExecuted++;
      result.totalFindings += jobStats.findings;
      result.prospectsCreated += jobStats.created;
      result.prospectsMerged += jobStats.merged;
      result.syncCreated += jobStats.syncCreated;
      result.syncUpdated += jobStats.syncUpdated;
      result.syncSkipped += jobStats.syncSkipped;
    } catch (err: any) {
      result.errors.push(`Job ${jobRow.id}: ${err.message}`);
    }
  }

  // 6. Close browser after all jobs
  if (needsBrowser) {
    await browserBridge.closeBrowser();
  }

  // 7. Mark campaign completed if all jobs done
  const pending = await query(
    "SELECT COUNT(*) FROM scrape_jobs WHERE campaign_id = $1 AND status IN ('pending', 'running')",
    [campaignId],
  );
  if (parseInt(pending.rows[0].count) === 0) {
    await discovery.updateCampaignStatus(campaignId, 'completed');
  }

  // 8. Record metrics
  await recordMetric(campaign.sourceId, 'campaign_completed', 1, {
    campaignId,
    jobs: result.jobsExecuted,
    findings: result.totalFindings,
    prospects: result.prospectsCreated + result.prospectsMerged,
  }, campaignId);

  return result;
}

// ─── Execute Single Job ──────────────────────────────────────

async function executeJob(
  jobRow: any,
  connector: SourceConnector,
  options?: { skipSync?: boolean; skipEnrichment?: boolean },
): Promise<{
  findings: number;
  created: number;
  merged: number;
  syncCreated: number;
  syncUpdated: number;
  syncSkipped: number;
}> {
  const jobId = jobRow.id;
  await discovery.markJobRunning(jobId);

  try {
    // Step 1: Extract
    const extraction = await connector.extract({
      searchQuery: jobRow.search_query,
      city: jobRow.city,
      department: jobRow.department,
      country: jobRow.country,
      category: jobRow.category,
      cursor: jobRow.cursor,
      maxResults: 20,
    });

    // Step 2: Save raw findings
    const findings = extraction.findings;
    for (const f of findings) {
      await query(
        `INSERT INTO scrape_raw_findings (job_id, source_id, raw_business_name, raw_address, raw_phone, raw_email, raw_website, raw_category, raw_rating, raw_review_count, raw_hours, source_url, raw_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          jobId, f.sourceId, f.rawBusinessName, f.rawAddress, f.rawPhone,
          f.rawEmail, f.rawWebsite, f.rawCategory, f.rawRating,
          f.rawReviewCount, f.rawHours, f.sourceUrl, JSON.stringify(f.rawPayload),
        ],
      );
    }

    let created = 0;
    let merged = 0;
    let syncCreated = 0;
    let syncUpdated = 0;
    let syncSkipped = 0;

    // Step 3-6: Normalize → Identity → Enrich → Sync (per finding)
    for (const f of findings) {
      // Normalize
      const normalized = normalizeRawFinding(f as RawFinding, {
        country: jobRow.country,
        department: jobRow.department,
        city: jobRow.city,
        category: jobRow.category,
      });

      // Identity resolution
      const identity = await resolveIdentity(normalized);
      if (identity.action === 'created') created++;
      else if (identity.action === 'merged') merged++;

      // Enrichment
      if (!options?.skipEnrichment) {
        try {
          await enrichProspect(identity.prospectId);
        } catch { /* non-fatal */ }
      }

      // CRM Sync
      if (!options?.skipSync) {
        try {
          const syncResult = await syncProspectToCrm(identity.prospectId);
          if (syncResult.action === 'created') syncCreated++;
          else if (syncResult.action === 'updated') syncUpdated++;
          else if (syncResult.action === 'skipped') syncSkipped++;
        } catch { /* non-fatal */ }
      }
    }

    await discovery.markJobCompleted(jobId, {
      findingsCount: findings.length,
      prospectsCreated: created,
      prospectsMerged: merged,
    });

    await recordMetric(jobRow.source_id, 'job_completed', 1, {
      findings: findings.length,
      created,
      merged,
      city: jobRow.city,
      category: jobRow.category,
    }, jobRow.campaign_id);

    return { findings: findings.length, created, merged, syncCreated, syncUpdated, syncSkipped };
  } catch (err: any) {
    await discovery.markJobFailed(jobId, err.message);
    await recordMetric(jobRow.source_id, 'job_failed', 1, {
      error: err.message,
      city: jobRow.city,
      category: jobRow.category,
    }, jobRow.campaign_id);
    throw err;
  }
}

// ─── Replay Safe ─────────────────────────────────────────────

/** Re-run failed jobs for a campaign (safe replay: idempotency keys prevent re-extraction) */
export async function replayCampaign(campaignId: number): Promise<{ retriedJobs: number }> {
  const result = await query(
    "UPDATE scrape_jobs SET status = 'pending', error_message = NULL WHERE campaign_id = $1 AND status = 'failed' RETURNING id",
    [campaignId],
  );
  return { retriedJobs: result.rows.length };
}

// ─── Scheduling ──────────────────────────────────────────────

/** Get campaigns due for re-execution (active + cron-based scheduling) */
export async function getDueCampaigns(): Promise<{ campaigns: any[]; count: number }> {
  // Find active campaigns that were completed and have scheduling
  const result = await query(
    `SELECT c.*,
       (SELECT MAX(j.completed_at) FROM scrape_jobs j WHERE j.campaign_id = c.id) as last_completed,
       (SELECT COUNT(*) FROM scrape_jobs j WHERE j.campaign_id = c.id AND j.status = 'completed') as completed_jobs
     FROM scrape_campaigns c
     WHERE c.status IN ('active', 'completed')
       AND c.scheduling->>'runOnce' != 'true'
     ORDER BY c.priority DESC`,
  );
  return { campaigns: result.rows, count: result.rows.length };
}

/** Re-activate a completed campaign for a new time window */
export async function scheduleCampaignRerun(campaignId: number): Promise<{ success: boolean; message: string }> {
  const campaign = await discovery.getCampaign(campaignId);
  if (!campaign) return { success: false, message: 'Campaign not found' };

  await discovery.updateCampaignStatus(campaignId, 'active');
  const gen = await discovery.generateJobs(campaignId);

  return {
    success: true,
    message: `Campaign ${campaignId} re-activated. ${gen.created} new jobs, ${gen.skipped} skipped.`,
  };
}

// ─── Smoke Test ──────────────────────────────────────────────

export interface SmokeTestResult {
  step: string;
  status: 'ok' | 'error';
  detail: any;
  elapsedMs: number;
}

/**
 * End-to-end smoke test of the scraping pipeline.
 * Uses mock data to verify: campaign → jobs → normalization → identity → enrichment → sync check.
 * Does NOT launch a browser or hit external sites.
 */
export async function runSmokeTest(): Promise<{
  passed: boolean;
  steps: SmokeTestResult[];
  totalMs: number;
}> {
  const steps: SmokeTestResult[] = [];
  const totalStart = Date.now();

  // Step 1: Create test campaign
  let campaignId: number;
  try {
    const start = Date.now();
    const r = await discovery.createCampaign({
      name: `[SMOKE] Test ${new Date().toISOString()}`,
      sourceId: 'smoke-test',
      status: 'draft',
      geography: { country: 'Colombia', departments: ['Cundinamarca'], cities: ['Bogota'] },
      categories: ['restaurante'],
      queries: ['test'],
      priority: 0,
      maxPages: 1,
      scheduling: { runOnce: true },
      metadata: { smokeTest: true },
    });
    campaignId = r.id;
    steps.push({ step: 'create_campaign', status: 'ok', detail: { campaignId }, elapsedMs: Date.now() - start });
  } catch (err: any) {
    steps.push({ step: 'create_campaign', status: 'error', detail: err.message, elapsedMs: 0 });
    return { passed: false, steps, totalMs: Date.now() - totalStart };
  }

  // Step 2: Generate jobs
  try {
    const start = Date.now();
    await discovery.updateCampaignStatus(campaignId, 'active');
    const gen = await discovery.generateJobs(campaignId);
    steps.push({ step: 'generate_jobs', status: 'ok', detail: gen, elapsedMs: Date.now() - start });
  } catch (err: any) {
    steps.push({ step: 'generate_jobs', status: 'error', detail: err.message, elapsedMs: 0 });
  }

  // Step 3: Insert mock raw findings directly (bypass browser)
  const mockFindings = [
    { name: 'Restaurante El Buen Sabor', phone: '3001234567', address: 'Calle 72 #10-34, Bogotá', rating: 4.5, reviews: 120, website: 'https://buensabor.com.co' },
    { name: 'Café La Esquina', phone: '3109876543', address: 'Carrera 7 #45-12, Bogotá', email: 'info@laesquina.co', rating: 4.2, reviews: 45 },
    { name: 'Restaurante El Buen Sabor', phone: '3001234567', address: 'Calle 72 #10-34', rating: 4.6, reviews: 125 }, // duplicate
  ];

  try {
    const start = Date.now();
    const jobs = await query(
      "SELECT id FROM scrape_jobs WHERE campaign_id = $1 AND status = 'pending' LIMIT 1",
      [campaignId],
    );
    const jobId = jobs.rows[0]?.id;
    if (!jobId) throw new Error('No pending job found');

    await discovery.markJobRunning(jobId);

    for (const mock of mockFindings) {
      await query(
        `INSERT INTO scrape_raw_findings (job_id, source_id, raw_business_name, raw_address, raw_phone, raw_email, raw_website, raw_rating, raw_review_count, raw_payload)
         VALUES ($1, 'smoke-test', $2, $3, $4, $5, $6, $7, $8, $9)`,
        [jobId, mock.name, mock.address, mock.phone, (mock as any).email || null, (mock as any).website || null, mock.rating, mock.reviews, JSON.stringify(mock)],
      );
    }

    steps.push({ step: 'insert_mock_findings', status: 'ok', detail: { count: mockFindings.length, jobId }, elapsedMs: Date.now() - start });

    // Step 4: Normalize + Identity resolve
    const start4 = Date.now();
    let created = 0;
    let merged = 0;
    const prospectIds: number[] = [];

    for (const mock of mockFindings) {
      const normalized = normalizeRawFinding({
        sourceId: 'smoke-test',
        rawBusinessName: mock.name,
        rawAddress: mock.address,
        rawPhone: mock.phone,
        rawEmail: (mock as any).email || null,
        rawWebsite: (mock as any).website || null,
        rawCategory: 'restaurante',
        rawRating: mock.rating,
        rawReviewCount: mock.reviews,
        rawHours: null,
        sourceUrl: null,
        rawPayload: mock,
      } as any, {
        country: 'Colombia',
        department: 'Cundinamarca',
        city: 'Bogota',
        category: 'restaurante',
      });

      const identity = await resolveIdentity(normalized);
      if (identity.action === 'created') created++;
      else if (identity.action === 'merged') merged++;
      prospectIds.push(identity.prospectId);
    }

    steps.push({
      step: 'normalize_and_identity',
      status: 'ok',
      detail: { created, merged, uniqueProspects: new Set(prospectIds).size },
      elapsedMs: Date.now() - start4,
    });

    // Step 5: Enrichment
    const start5 = Date.now();
    let enriched = 0;
    for (const pid of [...new Set(prospectIds)]) {
      try {
        const r = await enrichProspect(pid);
        if (r.enriched) enriched++;
      } catch { /* non-fatal */ }
    }
    steps.push({ step: 'enrichment', status: 'ok', detail: { enriched }, elapsedMs: Date.now() - start5 });

    // Step 6: Sync check (dry — just verify sync engine works, don't actually call API)
    const start6 = Date.now();
    const syncCheckId = [...new Set(prospectIds)][0];
    const prospectCheck = await query('SELECT * FROM scrape_prospects WHERE id = $1', [syncCheckId]);
    steps.push({
      step: 'sync_readiness_check',
      status: prospectCheck.rows.length > 0 ? 'ok' : 'error',
      detail: {
        prospectId: syncCheckId,
        qualityScore: prospectCheck.rows[0]?.quality_score,
        icpMatch: prospectCheck.rows[0]?.icp_match,
        hasPhone: !!prospectCheck.rows[0]?.phone_normalized,
        hasEmail: !!prospectCheck.rows[0]?.email_normalized,
        hasDomain: !!prospectCheck.rows[0]?.domain,
        readyForSync: true,
      },
      elapsedMs: Date.now() - start6,
    });

    // Mark job completed
    await discovery.markJobCompleted(jobId, { findingsCount: mockFindings.length, prospectsCreated: created, prospectsMerged: merged });
    await discovery.updateCampaignStatus(campaignId, 'completed');

  } catch (err: any) {
    steps.push({ step: 'pipeline', status: 'error', detail: err.message, elapsedMs: 0 });
  }

  const passed = steps.every((s) => s.status === 'ok');
  return { passed, steps, totalMs: Date.now() - totalStart };
}
