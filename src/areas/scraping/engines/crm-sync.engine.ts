/**
 * CRM Sync Engine
 * Decides when to create, update, or skip syncing to CRM Directorio.
 * Uses material change detection + sync hash for idempotency.
 */
import { createHash } from 'crypto';
import { query } from '../../../db/client.js';
import { api } from '../../../services/api-client.js';
import { MATERIAL_CHANGE_FIELDS, type SyncAction } from '../schemas/index.js';

// ─── Sync Hash ───────────────────────────────────────────────

function buildSyncHash(prospect: any): string {
  const material: Record<string, any> = {};
  for (const field of MATERIAL_CHANGE_FIELDS) {
    const dbField = field.replace(/([A-Z])/g, '_$1').toLowerCase();
    material[field] = prospect[dbField] ?? prospect[field] ?? null;
  }
  const json = JSON.stringify(material, Object.keys(material).sort());
  return createHash('sha256').update(json).digest('hex').substring(0, 64);
}

function detectMaterialChanges(prospect: any, lastSyncHash: string | null): {
  hasChanges: boolean;
  currentHash: string;
  changes: string[];
} {
  const currentHash = buildSyncHash(prospect);

  if (!lastSyncHash) {
    return { hasChanges: true, currentHash, changes: ['new_record'] };
  }

  if (currentHash === lastSyncHash) {
    return { hasChanges: false, currentHash, changes: [] };
  }

  // Determine what changed (best-effort)
  const changes: string[] = [];
  if (prospect.email_normalized) changes.push('email_updated');
  if (prospect.phone_normalized) changes.push('phone_updated');
  if (prospect.domain) changes.push('domain_updated');
  if (prospect.quality_score > 0) changes.push('quality_improved');
  if (prospect.icp_match) changes.push('icp_classified');
  if (changes.length === 0) changes.push('data_changed');

  return { hasChanges: true, currentHash, changes };
}

// ─── Sync a Single Prospect ─────────────────────────────────

export async function syncProspectToCrm(prospectId: number): Promise<{
  action: SyncAction;
  crmDirectoryId: string | null;
  changes: string[];
}> {
  // Load prospect
  const prospectResult = await query('SELECT * FROM scrape_prospects WHERE id = $1', [prospectId]);
  if (prospectResult.rows.length === 0) throw new Error(`Prospect ${prospectId} not found`);
  const prospect = prospectResult.rows[0];

  // Get last sync entry
  const lastSync = await query(
    'SELECT sync_hash, crm_directory_id FROM scrape_sync_ledger WHERE prospect_id = $1 ORDER BY created_at DESC LIMIT 1',
    [prospectId],
  );
  const lastHash = lastSync.rows[0]?.sync_hash || null;
  const existingCrmId = lastSync.rows[0]?.crm_directory_id || null;

  // Check for material changes
  const { hasChanges, currentHash, changes } = detectMaterialChanges(prospect, lastHash);

  if (!hasChanges) {
    // Record skip in ledger
    await recordSync(prospectId, existingCrmId, 'skipped', currentHash, [], {}, {});
    return { action: 'skipped', crmDirectoryId: existingCrmId, changes: [] };
  }

  // Build CRM payload — include all enrichment fields
  const payload = {
    businessName: prospect.business_name,
    businessNameNormalized: prospect.business_name_normalized || undefined,
    email: prospect.email || undefined,
    emailNormalized: prospect.email_normalized || undefined,
    phone: prospect.phone || undefined,
    phoneNormalized: prospect.phone_normalized || undefined,
    website: prospect.website || undefined,
    domain: prospect.domain || undefined,
    address: prospect.address || undefined,
    country: prospect.country,
    department: prospect.department,
    city: prospect.city,
    category: prospect.category,
    rating: prospect.rating ?? undefined,
    reviewCount: prospect.review_count ?? undefined,
    source: 'SCRAPER',
    sourceLabel: `scraping:${(prospect.source_ids || []).join(',')}`,
    sourceUrl: (prospect.source_urls || [])[0] || undefined,
    searchQuery: prospect.category_normalized,
    tags: [
      `quality:${prospect.quality_score}`,
      prospect.icp_match ? `icp:${prospect.icp_match}` : null,
      `sources:${(prospect.source_ids || []).length}`,
    ].filter(Boolean),
    enrichment: {
      commercialSignals: prospect.commercial_signals || {},
      hours: prospect.hours || undefined,
      allSourceUrls: prospect.source_urls || [],
      icpMatch: prospect.icp_match || undefined,
      qualityScore: prospect.quality_score,
      firstSeenAt: prospect.first_seen_at || undefined,
      lastSeenAt: prospect.last_seen_at || undefined,
      enrichmentVersion: prospect.enrichment_version || undefined,
    },
    metadata: {
      prospectId: prospect.id,
      fingerprint: prospect.fingerprint,
    },
  };

  try {
    // Use sales_directory_import (batch of 1)
    const res = await api.post('/crm/directorio/import', { items: [payload] });

    if (!res.ok) {
      await recordSync(prospectId, null, 'failed', currentHash, changes, payload, { error: res.data });
      return { action: 'failed', crmDirectoryId: null, changes };
    }

    const crmId = res.data?.imported?.[0]?.id || res.data?.results?.[0]?.id || existingCrmId;
    const action: SyncAction = existingCrmId ? 'updated' : 'created';

    await recordSync(prospectId, crmId, action, currentHash, changes, payload, res.data);
    return { action, crmDirectoryId: crmId, changes };
  } catch (err: any) {
    await recordSync(prospectId, null, 'failed', currentHash, changes, payload, { error: err.message });
    return { action: 'failed', crmDirectoryId: null, changes };
  }
}

// ─── Batch Sync ──────────────────────────────────────────────

export async function syncBatchToCrm(options?: {
  minQuality?: number;
  icpMatch?: string;
  limit?: number;
}): Promise<{
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}> {
  const minQuality = options?.minQuality ?? 20;
  const limit = options?.limit ?? 50;

  let sql = `
    SELECT p.id FROM scrape_prospects p
    WHERE p.quality_score >= $1
  `;
  const params: any[] = [minQuality];
  let idx = 2;

  if (options?.icpMatch) {
    sql += ` AND p.icp_match = $${idx++}`;
    params.push(options.icpMatch);
  }

  // Exclude recently synced (within last hour) and those with no changes
  sql += `
    AND (
      NOT EXISTS (SELECT 1 FROM scrape_sync_ledger sl WHERE sl.prospect_id = p.id)
      OR p.updated_at > (SELECT MAX(sl2.created_at) FROM scrape_sync_ledger sl2 WHERE sl2.prospect_id = p.id)
    )
    ORDER BY p.quality_score DESC
    LIMIT $${idx++}
  `;
  params.push(limit);

  const result = await query(sql, params);

  const stats = { created: 0, updated: 0, skipped: 0, failed: 0 };

  for (const row of result.rows) {
    try {
      const r = await syncProspectToCrm(row.id);
      stats[r.action]++;
    } catch {
      stats.failed++;
    }
  }

  return stats;
}

// ─── Ledger Recording ────────────────────────────────────────

async function recordSync(
  prospectId: number,
  crmDirectoryId: string | null,
  action: SyncAction,
  syncHash: string,
  materialChanges: string[],
  payload: any,
  responseData: any,
): Promise<void> {
  await query(
    `INSERT INTO scrape_sync_ledger (prospect_id, crm_directory_id, action, sync_hash, material_changes, payload, response_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [prospectId, crmDirectoryId, action, syncHash, materialChanges, JSON.stringify(payload), JSON.stringify(responseData)],
  );
}
