/**
 * Enrichment Engine
 * Incrementally enriches prospects with quality scores, ICP matching,
 * commercial signals, and geographic/category classification.
 */
import { query } from '../../../db/client.js';

// ─── Quality Score Calculation ───────────────────────────────

interface QualityFactors {
  hasPhone: boolean;
  hasEmail: boolean;
  hasWebsite: boolean;
  hasDomain: boolean;
  hasAddress: boolean;
  hasRating: boolean;
  hasReviewCount: boolean;
  hasHours: boolean;
  reviewCount: number;
  rating: number;
  sourceCount: number;
}

function calculateQualityScore(f: QualityFactors): number {
  let score = 0;
  // Contact completeness (max 40)
  if (f.hasPhone) score += 12;
  if (f.hasEmail) score += 15;
  if (f.hasWebsite) score += 8;
  if (f.hasDomain) score += 5;
  // Business info (max 25)
  if (f.hasAddress) score += 8;
  if (f.hasRating) score += 5;
  if (f.hasHours) score += 5;
  if (f.hasReviewCount && f.reviewCount > 10) score += 7;
  // Social proof (max 20)
  if (f.rating >= 4.0) score += 10;
  else if (f.rating >= 3.0) score += 5;
  if (f.reviewCount >= 100) score += 10;
  else if (f.reviewCount >= 20) score += 5;
  // Multi-source confirmation (max 15)
  if (f.sourceCount >= 3) score += 15;
  else if (f.sourceCount >= 2) score += 10;
  else score += 3;

  return Math.min(100, score);
}

// ─── ICP Matching ────────────────────────────────────────────

function determineIcpMatch(prospect: any): 'high' | 'medium' | 'low' {
  let signals = 0;
  // Has digital presence
  if (prospect.domain || prospect.website) signals += 2;
  if (prospect.email) signals += 2;
  // Active business signals
  if (prospect.rating && parseFloat(prospect.rating) >= 3.5) signals += 1;
  if (prospect.review_count && parseInt(prospect.review_count) >= 10) signals += 1;
  // Good contact info
  if (prospect.phone_normalized) signals += 1;
  if (prospect.hours) signals += 1;

  if (signals >= 6) return 'high';
  if (signals >= 3) return 'medium';
  return 'low';
}

// ─── Commercial Signals ──────────────────────────────────────

function extractCommercialSignals(prospect: any): Record<string, any> {
  const signals: Record<string, any> = {};

  if (prospect.website || prospect.domain) {
    signals.hasDigitalPresence = true;
  }
  if (prospect.review_count) {
    const rc = parseInt(prospect.review_count);
    signals.reviewVolume = rc >= 100 ? 'high' : rc >= 20 ? 'medium' : 'low';
  }
  if (prospect.rating) {
    const r = parseFloat(prospect.rating);
    signals.reputation = r >= 4.5 ? 'excellent' : r >= 4.0 ? 'good' : r >= 3.0 ? 'fair' : 'poor';
  }
  if (prospect.source_ids?.length >= 2) {
    signals.multiSourceConfirmed = true;
  }

  return signals;
}

// ─── Main Enrichment ─────────────────────────────────────────

export async function enrichProspect(prospectId: number): Promise<{
  enriched: boolean;
  changes: string[];
  qualityScore: number;
  icpMatch: string;
}> {
  const result = await query('SELECT * FROM scrape_prospects WHERE id = $1', [prospectId]);
  if (result.rows.length === 0) throw new Error(`Prospect ${prospectId} not found`);

  const prospect = result.rows[0];
  const changes: string[] = [];
  const currentVersion = prospect.enrichment_version || 0;

  // Calculate quality score
  const qualityScore = calculateQualityScore({
    hasPhone: !!prospect.phone_normalized,
    hasEmail: !!prospect.email_normalized,
    hasWebsite: !!prospect.website,
    hasDomain: !!prospect.domain,
    hasAddress: !!prospect.address,
    hasRating: !!prospect.rating,
    hasReviewCount: !!prospect.review_count,
    hasHours: !!prospect.hours,
    reviewCount: parseInt(prospect.review_count) || 0,
    rating: parseFloat(prospect.rating) || 0,
    sourceCount: (prospect.source_ids || []).length,
  });

  if (qualityScore !== (prospect.quality_score || 0)) {
    changes.push('quality_score');
  }

  // Determine ICP match
  const icpMatch = determineIcpMatch(prospect);
  if (icpMatch !== prospect.icp_match) {
    changes.push('icp_match');
  }

  // Extract commercial signals
  const commercialSignals = extractCommercialSignals(prospect);
  const prevSignals = prospect.commercial_signals || {};
  if (JSON.stringify(commercialSignals) !== JSON.stringify(prevSignals)) {
    changes.push('commercial_signals');
  }

  if (changes.length === 0) {
    return { enriched: false, changes: [], qualityScore, icpMatch };
  }

  // Save enrichment snapshot
  await query(
    `INSERT INTO scrape_enrichment_snapshots (prospect_id, version, enrichment_type, data_before, data_after, source)
     VALUES ($1, $2, 'quality', $3, $4, 'auto-enrichment')`,
    [
      prospectId,
      currentVersion + 1,
      JSON.stringify({
        quality_score: prospect.quality_score,
        icp_match: prospect.icp_match,
        commercial_signals: prevSignals,
      }),
      JSON.stringify({ quality_score: qualityScore, icp_match: icpMatch, commercial_signals: commercialSignals }),
    ],
  );

  // Update prospect
  await query(
    `UPDATE scrape_prospects SET
       quality_score = $2, icp_match = $3, commercial_signals = $4,
       enrichment_version = $5, updated_at = NOW()
     WHERE id = $1`,
    [prospectId, qualityScore, icpMatch, JSON.stringify(commercialSignals), currentVersion + 1],
  );

  return { enriched: true, changes, qualityScore, icpMatch };
}

/** Batch enrich all prospects that haven't been enriched yet or need re-enrichment */
export async function enrichBatch(limit: number = 100): Promise<{
  processed: number;
  enriched: number;
  errors: number;
}> {
  const result = await query(
    `SELECT id FROM scrape_prospects
     WHERE enrichment_version = 0 OR updated_at > (
       SELECT MAX(created_at) FROM scrape_enrichment_snapshots WHERE prospect_id = scrape_prospects.id
     )
     ORDER BY quality_score ASC, created_at DESC
     LIMIT $1`,
    [limit],
  );

  let enriched = 0;
  let errors = 0;

  for (const row of result.rows) {
    try {
      const r = await enrichProspect(row.id);
      if (r.enriched) enriched++;
    } catch {
      errors++;
    }
  }

  return { processed: result.rows.length, enriched, errors };
}
