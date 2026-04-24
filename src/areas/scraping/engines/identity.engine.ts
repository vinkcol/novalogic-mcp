/**
 * Identity & Idempotency Engine
 * Resolves duplicates and prevents reprocessing.
 * Uses fingerprint-based identity with strong/weak signal fallback.
 */
import { query } from '../../../db/client.js';
import type { ProspectRecord } from '../schemas/index.js';

export interface IdentityResult {
  action: 'created' | 'merged' | 'unchanged';
  prospectId: number;
  fingerprint: string;
}

/**
 * Upsert a normalized prospect:
 * - If fingerprint matches: merge (update fields, append sources)
 * - If no match: insert new
 * - Returns whether it was created, merged, or unchanged
 */
export async function resolveIdentity(
  prospect: Omit<ProspectRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<IdentityResult> {
  // 1. Try exact fingerprint match
  const existing = await query(
    'SELECT * FROM scrape_prospects WHERE fingerprint = $1',
    [prospect.fingerprint],
  );

  if (existing.rows.length > 0) {
    return mergeProspect(existing.rows[0], prospect);
  }

  // 2. Try fuzzy match: same domain or same phone or same normalized name+city
  const fuzzy = await findFuzzyMatch(prospect);
  if (fuzzy) {
    return mergeProspect(fuzzy, prospect);
  }

  // 3. No match → create new
  const result = await query(
    `INSERT INTO scrape_prospects (
       fingerprint, business_name, business_name_normalized, phone, phone_normalized,
       email, email_normalized, website, domain, address, country, department, city,
       city_normalized, category, category_normalized, rating, review_count, hours,
       source_ids, source_urls, first_seen_at, last_seen_at, enrichment_version,
       quality_score, icp_match, commercial_signals, metadata
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
     RETURNING id`,
    [
      prospect.fingerprint, prospect.businessName, prospect.businessNameNormalized,
      prospect.phone, prospect.phoneNormalized, prospect.email, prospect.emailNormalized,
      prospect.website, prospect.domain, prospect.address, prospect.country,
      prospect.department, prospect.city, prospect.cityNormalized, prospect.category,
      prospect.categoryNormalized, prospect.rating, prospect.reviewCount, prospect.hours,
      prospect.sourceIds, prospect.sourceUrls, prospect.firstSeenAt, prospect.lastSeenAt,
      prospect.enrichmentVersion, prospect.qualityScore, prospect.icpMatch,
      JSON.stringify(prospect.commercialSignals), JSON.stringify(prospect.metadata),
    ],
  );

  return {
    action: 'created',
    prospectId: result.rows[0].id,
    fingerprint: prospect.fingerprint,
  };
}

// ─── Fuzzy Match ─────────────────────────────────────────────

async function findFuzzyMatch(
  prospect: Omit<ProspectRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<any | null> {
  // Match by domain (strong signal)
  if (prospect.domain) {
    const byDomain = await query(
      'SELECT * FROM scrape_prospects WHERE domain = $1 LIMIT 1',
      [prospect.domain],
    );
    if (byDomain.rows.length > 0) return byDomain.rows[0];
  }

  // Match by normalized phone (strong signal)
  if (prospect.phoneNormalized && prospect.phoneNormalized.length >= 10) {
    const byPhone = await query(
      'SELECT * FROM scrape_prospects WHERE phone_normalized = $1 LIMIT 1',
      [prospect.phoneNormalized],
    );
    if (byPhone.rows.length > 0) return byPhone.rows[0];
  }

  // Match by normalized email (strong signal)
  if (prospect.emailNormalized) {
    const byEmail = await query(
      'SELECT * FROM scrape_prospects WHERE email_normalized = $1 LIMIT 1',
      [prospect.emailNormalized],
    );
    if (byEmail.rows.length > 0) return byEmail.rows[0];
  }

  // Match by name+city (weak signal — requires high similarity)
  if (prospect.businessNameNormalized.length > 3) {
    const byName = await query(
      `SELECT *, similarity(business_name_normalized, $1) as sim
       FROM scrape_prospects
       WHERE city_normalized = $2
         AND similarity(business_name_normalized, $1) > 0.7
       ORDER BY sim DESC
       LIMIT 1`,
      [prospect.businessNameNormalized, prospect.cityNormalized],
    );
    if (byName.rows.length > 0) return byName.rows[0];
  }

  return null;
}

// ─── Merge Logic ─────────────────────────────────────────────

async function mergeProspect(
  existing: any,
  incoming: Omit<ProspectRecord, 'id' | 'createdAt' | 'updatedAt'>,
): Promise<IdentityResult> {
  const updates: string[] = [];
  const params: any[] = [];
  let idx = 1;
  let changed = false;

  // Merge source arrays (append new sources)
  const existingSources = existing.source_ids || [];
  const newSources = incoming.sourceIds.filter((s: string) => !existingSources.includes(s));
  if (newSources.length > 0) {
    updates.push(`source_ids = source_ids || $${idx++}`);
    params.push(newSources);
    changed = true;
  }

  const existingUrls = existing.source_urls || [];
  const newUrls = incoming.sourceUrls.filter((u: string) => !existingUrls.includes(u));
  if (newUrls.length > 0) {
    updates.push(`source_urls = source_urls || $${idx++}`);
    params.push(newUrls);
    changed = true;
  }

  // Fill empty fields (don't overwrite existing data)
  const fillIfEmpty: [string, string, any][] = [
    ['phone', 'phone', incoming.phone],
    ['phone_normalized', 'phoneNormalized', incoming.phoneNormalized],
    ['email', 'email', incoming.email],
    ['email_normalized', 'emailNormalized', incoming.emailNormalized],
    ['website', 'website', incoming.website],
    ['domain', 'domain', incoming.domain],
    ['address', 'address', incoming.address],
    ['rating', 'rating', incoming.rating],
    ['review_count', 'reviewCount', incoming.reviewCount],
    ['hours', 'hours', incoming.hours],
  ];

  for (const [col, _field, value] of fillIfEmpty) {
    if (value && !existing[col]) {
      updates.push(`${col} = $${idx++}`);
      params.push(value);
      changed = true;
    }
  }

  // Update rating if incoming is more recent/higher
  if (incoming.rating && existing.rating && incoming.rating !== parseFloat(existing.rating)) {
    updates.push(`rating = $${idx++}`);
    params.push(incoming.rating);
    changed = true;
  }

  // Always update last_seen_at
  updates.push(`last_seen_at = NOW()`);
  updates.push(`updated_at = NOW()`);

  if (updates.length > 0) {
    params.push(existing.id);
    await query(
      `UPDATE scrape_prospects SET ${updates.join(', ')} WHERE id = $${idx}`,
      params,
    );
  }

  return {
    action: changed ? 'merged' : 'unchanged',
    prospectId: existing.id,
    fingerprint: existing.fingerprint,
  };
}

// ─── Lookup ──────────────────────────────────────────────────

export async function getProspect(id: number): Promise<ProspectRecord | null> {
  const result = await query('SELECT * FROM scrape_prospects WHERE id = $1', [id]);
  return result.rows[0] || null;
}

export async function listProspects(filters?: {
  city?: string; department?: string; category?: string;
  minQuality?: number; limit?: number; offset?: number;
}): Promise<{ prospects: any[]; total: number }> {
  let countSql = 'SELECT COUNT(*) FROM scrape_prospects WHERE 1=1';
  let sql = 'SELECT * FROM scrape_prospects WHERE 1=1';
  const params: any[] = [];
  let idx = 1;

  if (filters?.city) {
    const clause = ` AND city_normalized = $${idx++}`;
    sql += clause; countSql += clause;
    params.push(filters.city.toLowerCase());
  }
  if (filters?.department) {
    const clause = ` AND department ILIKE $${idx++}`;
    sql += clause; countSql += clause;
    params.push(`%${filters.department}%`);
  }
  if (filters?.category) {
    const clause = ` AND category_normalized = $${idx++}`;
    sql += clause; countSql += clause;
    params.push(filters.category.toLowerCase());
  }
  if (filters?.minQuality) {
    const clause = ` AND quality_score >= $${idx++}`;
    sql += clause; countSql += clause;
    params.push(filters.minQuality);
  }

  const countResult = await query(countSql, params);
  const total = parseInt(countResult.rows[0].count);

  sql += ` ORDER BY quality_score DESC, last_seen_at DESC`;
  sql += ` LIMIT $${idx++}`;
  params.push(filters?.limit || 50);
  sql += ` OFFSET $${idx++}`;
  params.push(filters?.offset || 0);

  const result = await query(sql, params);
  return { prospects: result.rows, total };
}
