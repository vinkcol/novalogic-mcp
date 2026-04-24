/**
 * Discovery Engine
 * Manages campaigns, generates jobs, handles scheduling and prioritization.
 */
import { query } from '../../../db/client.js';
import { buildJobKey, type ScrapeCampaign, type ScrapeJob } from '../schemas/index.js';

// ─── Current time window (weekly) ────────────────────────────
function currentTimeWindow(): string {
  const now = new Date();
  const year = now.getFullYear();
  const oneJan = new Date(year, 0, 1);
  const week = Math.ceil(((now.getTime() - oneJan.getTime()) / 86400000 + oneJan.getDay() + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// ─── Campaign CRUD ───────────────────────────────────────────

export async function createCampaign(c: Omit<ScrapeCampaign, 'id' | 'createdAt' | 'updatedAt'>): Promise<{ id: number }> {
  const result = await query(
    `INSERT INTO scrape_campaigns (name, source_id, status, geography, categories, queries, priority, max_pages, scheduling, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      c.name, c.sourceId, c.status || 'draft',
      JSON.stringify(c.geography), c.categories, c.queries,
      c.priority || 0, c.maxPages || 5,
      JSON.stringify(c.scheduling || { runOnce: true }),
      JSON.stringify(c.metadata || {}),
    ],
  );
  return { id: result.rows[0].id };
}

export async function getCampaign(id: number): Promise<ScrapeCampaign | null> {
  const result = await query('SELECT * FROM scrape_campaigns WHERE id = $1', [id]);
  return result.rows[0] ? mapCampaignRow(result.rows[0]) : null;
}

export async function listCampaigns(filters?: { status?: string; sourceId?: string }): Promise<ScrapeCampaign[]> {
  let sql = 'SELECT * FROM scrape_campaigns WHERE 1=1';
  const params: any[] = [];
  let idx = 1;
  if (filters?.status) { sql += ` AND status = $${idx++}`; params.push(filters.status); }
  if (filters?.sourceId) { sql += ` AND source_id = $${idx++}`; params.push(filters.sourceId); }
  sql += ' ORDER BY priority DESC, created_at DESC';
  const result = await query(sql, params);
  return result.rows.map(mapCampaignRow);
}

export async function updateCampaignStatus(id: number, status: ScrapeCampaign['status']): Promise<void> {
  await query('UPDATE scrape_campaigns SET status = $1, updated_at = NOW() WHERE id = $2', [status, id]);
}

// ─── Job Generation ──────────────────────────────────────────

/** Expands a campaign into individual jobs (one per query × city × page) */
export async function generateJobs(campaignId: number): Promise<{ created: number; skipped: number }> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const timeWindow = currentTimeWindow();
  const geo = campaign.geography;
  let created = 0;
  let skipped = 0;

  for (const q of campaign.queries) {
    for (const city of geo.cities) {
      for (const dept of geo.departments) {
        for (const cat of campaign.categories) {
          for (let page = 0; page < campaign.maxPages; page++) {
            const cursor = String(page);
            const key = buildJobKey({
              sourceId: campaign.sourceId,
              searchQuery: q,
              country: geo.country,
              department: dept,
              city,
              category: cat,
              cursor,
              timeWindow,
            });

            // Idempotency check: skip if job already exists for this key
            const existing = await query(
              'SELECT id, status FROM scrape_jobs WHERE idempotency_key = $1',
              [key],
            );

            if (existing.rows.length > 0) {
              const s = existing.rows[0].status;
              if (s === 'completed' || s === 'running') { skipped++; continue; }
              // Re-queue failed/pending jobs
              if (s === 'failed') {
                await query(
                  'UPDATE scrape_jobs SET status = $1, error_message = NULL WHERE id = $2',
                  ['pending', existing.rows[0].id],
                );
                created++;
                continue;
              }
              skipped++;
              continue;
            }

            await query(
              `INSERT INTO scrape_jobs (campaign_id, source_id, idempotency_key, status, search_query, country, department, city, category, cursor, time_window)
               VALUES ($1, $2, $3, 'pending', $4, $5, $6, $7, $8, $9, $10)`,
              [campaignId, campaign.sourceId, key, q, geo.country, dept, city, cat, cursor, timeWindow],
            );
            created++;
          }
        }
      }
    }
  }

  return { created, skipped };
}

/** Get next pending jobs to execute, ordered by priority */
export async function getNextJobs(limit: number = 10): Promise<ScrapeJob[]> {
  const result = await query(
    `SELECT j.*, c.priority as campaign_priority
     FROM scrape_jobs j
     JOIN scrape_campaigns c ON j.campaign_id = c.id
     WHERE j.status = 'pending' AND c.status = 'active'
     ORDER BY c.priority DESC, j.created_at ASC
     LIMIT $1`,
    [limit],
  );
  return result.rows.map(mapJobRow);
}

export async function markJobRunning(jobId: number): Promise<void> {
  await query("UPDATE scrape_jobs SET status = 'running', started_at = NOW() WHERE id = $1", [jobId]);
}

export async function markJobCompleted(jobId: number, stats: { findingsCount: number; prospectsCreated: number; prospectsMerged: number }): Promise<void> {
  await query(
    `UPDATE scrape_jobs SET status = 'completed', completed_at = NOW(),
     findings_count = $2, prospects_created = $3, prospects_merged = $4
     WHERE id = $1`,
    [jobId, stats.findingsCount, stats.prospectsCreated, stats.prospectsMerged],
  );
}

export async function markJobFailed(jobId: number, error: string): Promise<void> {
  await query(
    "UPDATE scrape_jobs SET status = 'failed', completed_at = NOW(), error_message = $2 WHERE id = $1",
    [jobId, error],
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function mapCampaignRow(row: any): ScrapeCampaign {
  return {
    id: row.id,
    name: row.name,
    sourceId: row.source_id,
    status: row.status,
    geography: row.geography,
    categories: row.categories || [],
    queries: row.queries || [],
    priority: row.priority,
    maxPages: row.max_pages,
    scheduling: row.scheduling || {},
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapJobRow(row: any): ScrapeJob {
  return {
    id: row.id,
    campaignId: row.campaign_id,
    sourceId: row.source_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    searchQuery: row.search_query,
    country: row.country,
    department: row.department,
    city: row.city,
    category: row.category,
    cursor: row.cursor,
    timeWindow: row.time_window,
    findingsCount: row.findings_count,
    prospectsCreated: row.prospects_created,
    prospectsMerged: row.prospects_merged,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    metadata: row.metadata || {},
    createdAt: row.created_at,
  };
}
