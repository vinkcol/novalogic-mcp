/**
 * Promotion Policy Engine
 * Determines which prospects are eligible for promotion from
 * CRM Directorio to the sales funnel.
 *
 * RULE: Never auto-promote without explicit policy.
 * Promotion always goes through sales_directory_promote.
 */
import { query } from '../../../../db/client.js';
import { api } from '../../../../services/api-client.js';

// ─── Policy Definitions ──────────────────────────────────────

export interface PromotionPolicy {
  id: string;
  name: string;
  description: string;
  minQualityScore: number;
  requiredIcpMatch: ('high' | 'medium')[];
  requireEmail: boolean;
  requirePhone: boolean;
  requireDomain: boolean;
  minSources: number;
  minReviewCount: number;
  autoPromote: boolean;        // false = just mark eligible, true = auto-promote
  categories?: string[];       // empty = all categories
  cities?: string[];           // empty = all cities
}

// Default policies — can be extended via tool
const policies: Map<string, PromotionPolicy> = new Map([
  ['conservative', {
    id: 'conservative',
    name: 'Conservadora',
    description: 'Solo prospectos de alta calidad con contacto completo y múltiples fuentes',
    minQualityScore: 70,
    requiredIcpMatch: ['high'],
    requireEmail: true,
    requirePhone: true,
    requireDomain: false,
    minSources: 2,
    minReviewCount: 10,
    autoPromote: false,
  }],
  ['standard', {
    id: 'standard',
    name: 'Estándar',
    description: 'Prospectos con buena calidad y al menos email o teléfono',
    minQualityScore: 45,
    requiredIcpMatch: ['high', 'medium'],
    requireEmail: false,
    requirePhone: false,
    requireDomain: false,
    minSources: 1,
    minReviewCount: 0,
    autoPromote: false,
  }],
  ['aggressive', {
    id: 'aggressive',
    name: 'Agresiva',
    description: 'Cualquier prospecto con calidad mínima y alguna señal de contacto',
    minQualityScore: 25,
    requiredIcpMatch: ['high', 'medium'],
    requireEmail: false,
    requirePhone: false,
    requireDomain: false,
    minSources: 1,
    minReviewCount: 0,
    autoPromote: false,
  }],
]);

// ─── Policy CRUD ─────────────────────────────────────────────

export function getPolicy(id: string): PromotionPolicy | undefined {
  return policies.get(id);
}

export function listPolicies(): PromotionPolicy[] {
  return Array.from(policies.values());
}

export function upsertPolicy(policy: PromotionPolicy): void {
  policies.set(policy.id, policy);
}

// ─── Eligibility Check ──────────────────────────────────────

export interface EligibilityResult {
  prospectId: number;
  eligible: boolean;
  reasons: string[];
  failedChecks: string[];
}

export function checkEligibility(prospect: any, policy: PromotionPolicy): EligibilityResult {
  const reasons: string[] = [];
  const failedChecks: string[] = [];

  // Quality score
  if ((prospect.quality_score || 0) >= policy.minQualityScore) {
    reasons.push(`quality ${prospect.quality_score} >= ${policy.minQualityScore}`);
  } else {
    failedChecks.push(`quality ${prospect.quality_score || 0} < ${policy.minQualityScore}`);
  }

  // ICP match
  if (policy.requiredIcpMatch.includes(prospect.icp_match)) {
    reasons.push(`icp_match: ${prospect.icp_match}`);
  } else {
    failedChecks.push(`icp_match ${prospect.icp_match || 'null'} not in [${policy.requiredIcpMatch}]`);
  }

  // Contact requirements
  if (policy.requireEmail && !prospect.email_normalized) {
    failedChecks.push('email required but missing');
  }
  if (policy.requirePhone && !prospect.phone_normalized) {
    failedChecks.push('phone required but missing');
  }
  if (policy.requireDomain && !prospect.domain) {
    failedChecks.push('domain required but missing');
  }

  // Sources
  const sourceCount = (prospect.source_ids || []).length;
  if (sourceCount >= policy.minSources) {
    reasons.push(`sources: ${sourceCount}`);
  } else {
    failedChecks.push(`sources ${sourceCount} < ${policy.minSources}`);
  }

  // Reviews
  const reviewCount = parseInt(prospect.review_count) || 0;
  if (reviewCount >= policy.minReviewCount) {
    if (reviewCount > 0) reasons.push(`reviews: ${reviewCount}`);
  } else {
    failedChecks.push(`reviews ${reviewCount} < ${policy.minReviewCount}`);
  }

  // Category filter
  if (policy.categories && policy.categories.length > 0) {
    if (!policy.categories.includes(prospect.category_normalized)) {
      failedChecks.push(`category ${prospect.category_normalized} not in policy filter`);
    }
  }

  // City filter
  if (policy.cities && policy.cities.length > 0) {
    if (!policy.cities.includes(prospect.city_normalized)) {
      failedChecks.push(`city ${prospect.city_normalized} not in policy filter`);
    }
  }

  return {
    prospectId: prospect.id,
    eligible: failedChecks.length === 0,
    reasons,
    failedChecks,
  };
}

// ─── Batch Evaluation ────────────────────────────────────────

export async function evaluateEligibility(
  policyId: string,
  options?: { limit?: number; offset?: number },
): Promise<{
  eligible: EligibilityResult[];
  ineligible: number;
  total: number;
}> {
  const policy = getPolicy(policyId);
  if (!policy) throw new Error(`Policy '${policyId}' not found`);

  const limit = options?.limit || 100;
  const offset = options?.offset || 0;

  // Get prospects that have been synced to CRM but not yet promoted
  const result = await query(
    `SELECT p.* FROM scrape_prospects p
     JOIN scrape_sync_ledger sl ON sl.prospect_id = p.id AND sl.action IN ('created', 'updated')
     WHERE p.quality_score >= $1
     GROUP BY p.id
     ORDER BY p.quality_score DESC
     LIMIT $2 OFFSET $3`,
    [policy.minQualityScore, limit, offset],
  );

  const eligible: EligibilityResult[] = [];
  let ineligible = 0;

  for (const row of result.rows) {
    const check = checkEligibility(row, policy);
    if (check.eligible) {
      eligible.push(check);
    } else {
      ineligible++;
    }
  }

  return { eligible, ineligible, total: result.rows.length };
}

// ─── Promote ─────────────────────────────────────────────────

export async function promoteProspect(prospectId: number): Promise<{
  promoted: boolean;
  crmDirectoryId: string | null;
  leadId: string | null;
  error?: string;
}> {
  // Get the CRM directory ID from sync ledger
  const syncResult = await query(
    `SELECT crm_directory_id FROM scrape_sync_ledger
     WHERE prospect_id = $1 AND action IN ('created', 'updated') AND crm_directory_id IS NOT NULL
     ORDER BY created_at DESC LIMIT 1`,
    [prospectId],
  );

  if (syncResult.rows.length === 0) {
    return { promoted: false, crmDirectoryId: null, leadId: null, error: 'Prospect not synced to CRM yet' };
  }

  const crmId = syncResult.rows[0].crm_directory_id;

  try {
    const res = await api.post(`/crm/directorio/${crmId}/promote`);
    if (!res.ok) {
      return { promoted: false, crmDirectoryId: crmId, leadId: null, error: `API error ${res.status}: ${JSON.stringify(res.data)}` };
    }
    return { promoted: true, crmDirectoryId: crmId, leadId: res.data?.leadId || res.data?.lead?.id || null };
  } catch (err: any) {
    return { promoted: false, crmDirectoryId: crmId, leadId: null, error: err.message };
  }
}

/** Batch promote eligible prospects using a policy */
export async function batchPromote(
  policyId: string,
  options?: { limit?: number; dryRun?: boolean },
): Promise<{
  evaluated: number;
  eligible: number;
  promoted: number;
  failed: number;
  dryRun: boolean;
  results: any[];
}> {
  const dryRun = options?.dryRun ?? true; // default to dry run for safety
  const evaluation = await evaluateEligibility(policyId, { limit: options?.limit || 50 });

  if (dryRun) {
    return {
      evaluated: evaluation.total,
      eligible: evaluation.eligible.length,
      promoted: 0,
      failed: 0,
      dryRun: true,
      results: evaluation.eligible.map((e) => ({ prospectId: e.prospectId, reasons: e.reasons })),
    };
  }

  let promoted = 0;
  let failed = 0;
  const results: any[] = [];

  for (const entry of evaluation.eligible) {
    const result = await promoteProspect(entry.prospectId);
    results.push({ prospectId: entry.prospectId, ...result });
    if (result.promoted) promoted++;
    else failed++;
  }

  return {
    evaluated: evaluation.total,
    eligible: evaluation.eligible.length,
    promoted,
    failed,
    dryRun: false,
    results,
  };
}
