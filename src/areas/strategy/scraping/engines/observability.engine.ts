/**
 * Observability & Learning Engine
 * Tracks metrics, errors, coverage, and performance by source/query/geo.
 */
import { query } from '../../../../db/client.js';

// ─── Record Metric ───────────────────────────────────────────

export async function recordMetric(
  sourceId: string,
  metricType: string,
  value: number,
  dimensions?: Record<string, any>,
  campaignId?: number,
): Promise<void> {
  await query(
    `INSERT INTO scrape_metrics (source_id, campaign_id, metric_type, value, dimensions)
     VALUES ($1, $2, $3, $4, $5)`,
    [sourceId, campaignId || null, metricType, value, JSON.stringify(dimensions || {})],
  );
}

// ─── Dashboard Metrics ───────────────────────────────────────

export async function getSourceMetrics(sourceId?: string): Promise<any> {
  const whereClause = sourceId ? 'WHERE source_id = $1' : '';
  const params = sourceId ? [sourceId] : [];

  const result = await query(
    `SELECT source_id, metric_type, SUM(value) as total, COUNT(*) as occurrences
     FROM scrape_metrics ${whereClause}
     GROUP BY source_id, metric_type
     ORDER BY source_id, metric_type`,
    params,
  );
  return result.rows;
}

export async function getCoverageReport(): Promise<any> {
  const geo = await query(
    `SELECT country, department, city, city_normalized, COUNT(*) as prospect_count,
            AVG(quality_score) as avg_quality,
            COUNT(CASE WHEN icp_match = 'high' THEN 1 END) as high_icp_count
     FROM scrape_prospects
     GROUP BY country, department, city, city_normalized
     ORDER BY prospect_count DESC`,
  );

  const categories = await query(
    `SELECT category_normalized, COUNT(*) as prospect_count,
            AVG(quality_score) as avg_quality
     FROM scrape_prospects
     GROUP BY category_normalized
     ORDER BY prospect_count DESC`,
  );

  const sources = await query(
    `SELECT UNNEST(source_ids) as source, COUNT(*) as prospect_count
     FROM scrape_prospects
     GROUP BY source
     ORDER BY prospect_count DESC`,
  );

  return {
    geography: geo.rows,
    categories: categories.rows,
    sources: sources.rows,
  };
}

export async function getJobStats(filters?: { sourceId?: string; campaignId?: number; days?: number }): Promise<any> {
  let sql = `
    SELECT status, COUNT(*) as count,
           AVG(findings_count) as avg_findings,
           AVG(prospects_created) as avg_created,
           AVG(prospects_merged) as avg_merged
    FROM scrape_jobs WHERE 1=1
  `;
  const params: any[] = [];
  let idx = 1;

  if (filters?.sourceId) {
    sql += ` AND source_id = $${idx++}`;
    params.push(filters.sourceId);
  }
  if (filters?.campaignId) {
    sql += ` AND campaign_id = $${idx++}`;
    params.push(filters.campaignId);
  }
  if (filters?.days) {
    sql += ` AND created_at > NOW() - INTERVAL '${Math.min(filters.days, 365)} days'`;
  }

  sql += ' GROUP BY status';
  const result = await query(sql, params);
  return result.rows;
}

export async function getSyncStats(): Promise<any> {
  const result = await query(
    `SELECT action, COUNT(*) as count,
            MAX(created_at) as last_sync
     FROM scrape_sync_ledger
     GROUP BY action
     ORDER BY count DESC`,
  );

  const recentErrors = await query(
    `SELECT sl.prospect_id, sl.response_data, sl.created_at, sp.business_name
     FROM scrape_sync_ledger sl
     JOIN scrape_prospects sp ON sp.id = sl.prospect_id
     WHERE sl.action = 'failed'
     ORDER BY sl.created_at DESC
     LIMIT 10`,
  );

  return {
    summary: result.rows,
    recentErrors: recentErrors.rows,
  };
}

export async function getFullDashboard(): Promise<any> {
  const [campaigns, jobs, prospects, sync, coverage] = await Promise.all([
    query(`SELECT status, COUNT(*) as count FROM scrape_campaigns GROUP BY status`),
    query(`SELECT status, COUNT(*) as count, SUM(findings_count) as total_findings FROM scrape_jobs GROUP BY status`),
    query(`SELECT COUNT(*) as total, AVG(quality_score) as avg_quality,
            COUNT(CASE WHEN icp_match = 'high' THEN 1 END) as high_icp,
            COUNT(CASE WHEN icp_match = 'medium' THEN 1 END) as medium_icp
           FROM scrape_prospects`),
    query(`SELECT action, COUNT(*) as count FROM scrape_sync_ledger GROUP BY action`),
    query(`SELECT COUNT(DISTINCT city_normalized) as cities, COUNT(DISTINCT category_normalized) as categories,
            COUNT(DISTINCT UNNEST(source_ids)) as sources FROM scrape_prospects`).catch(() =>
      query(`SELECT COUNT(DISTINCT city_normalized) as cities, COUNT(DISTINCT category_normalized) as categories FROM scrape_prospects`),
    ),
  ]);

  return {
    campaigns: campaigns.rows,
    jobs: jobs.rows,
    prospects: prospects.rows[0],
    sync: sync.rows,
    coverage: coverage.rows[0],
  };
}
