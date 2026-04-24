/**
 * Normalization Engine
 * Converts RawFinding → ProspectRecord with canonical form.
 */
import type { RawFinding, ProspectRecord } from '../schemas/index.js';

// ─── Text Normalization ──────────────────────────────────────

export function normalizeBusinessName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[.,\-_()&]/g, ' ')
    .replace(/\b(s\.?a\.?s\.?|s\.?a\.?|ltda\.?|s\.?r\.?l\.?|e\.?u\.?|inc\.?|llc\.?|corp\.?)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizePhone(raw: string | null): string | null {
  if (!raw) return null;
  // Strip everything except digits and leading +
  const cleaned = raw.replace(/[^\d+]/g, '');
  if (cleaned.length < 7) return null;
  // Colombian phone normalization: add +57 prefix if missing
  if (cleaned.startsWith('+57')) return cleaned;
  if (cleaned.startsWith('57') && cleaned.length >= 12) return `+${cleaned}`;
  if (cleaned.length === 10 && cleaned.startsWith('3')) return `+57${cleaned}`;
  if (cleaned.length === 7) return cleaned; // landline without area code
  return cleaned;
}

export function normalizeEmail(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.toLowerCase().trim();
  if (!trimmed.includes('@') || !trimmed.includes('.')) return null;
  return trimmed;
}

export function extractDomain(website: string | null, email: string | null): string | null {
  if (website) {
    try {
      const url = new URL(website.startsWith('http') ? website : `https://${website}`);
      return url.hostname.replace(/^www\./, '');
    } catch { /* ignore */ }
  }
  if (email) {
    const parts = email.split('@');
    if (parts.length === 2) return parts[1];
  }
  return null;
}

export function normalizeCity(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')  // strip accents
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeCategory(raw: string | null): string {
  if (!raw) return 'sin_categoria';
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .trim() || 'sin_categoria';
}

// ─── Fingerprint Generation ──────────────────────────────────

export function buildFingerprint(params: {
  businessNameNormalized: string;
  phoneNormalized: string | null;
  emailNormalized: string | null;
  domain: string | null;
  cityNormalized: string;
}): string {
  // Strong identity: domain or email take priority
  if (params.domain) {
    return `domain:${params.domain}`;
  }
  if (params.emailNormalized) {
    return `email:${params.emailNormalized}`;
  }
  // Medium: phone + city
  if (params.phoneNormalized && params.phoneNormalized.length >= 10) {
    return `phone:${params.phoneNormalized}`;
  }
  // Weak: name + city (fuzzy)
  return `name:${params.businessNameNormalized}@${params.cityNormalized}`;
}

// ─── Main Normalization ──────────────────────────────────────

export function normalizeRawFinding(
  finding: RawFinding,
  defaults: { country: string; department: string; city: string; category: string },
): Omit<ProspectRecord, 'id' | 'createdAt' | 'updatedAt'> {
  const businessNameNormalized = normalizeBusinessName(finding.rawBusinessName);
  const phoneNormalized = normalizePhone(finding.rawPhone);
  const emailNormalized = normalizeEmail(finding.rawEmail);
  const domain = extractDomain(finding.rawWebsite, finding.rawEmail);
  const cityNormalized = normalizeCity(defaults.city);
  const categoryNormalized = normalizeCategory(finding.rawCategory || defaults.category);

  const fingerprint = buildFingerprint({
    businessNameNormalized,
    phoneNormalized,
    emailNormalized,
    domain,
    cityNormalized,
  });

  const now = new Date().toISOString();

  return {
    fingerprint,
    businessName: finding.rawBusinessName.trim(),
    businessNameNormalized,
    phone: finding.rawPhone?.trim() || null,
    phoneNormalized,
    email: finding.rawEmail?.trim() || null,
    emailNormalized,
    website: finding.rawWebsite?.trim() || null,
    domain,
    address: finding.rawAddress?.trim() || null,
    country: defaults.country,
    department: defaults.department,
    city: defaults.city,
    cityNormalized,
    category: finding.rawCategory || defaults.category,
    categoryNormalized,
    rating: finding.rawRating,
    reviewCount: finding.rawReviewCount,
    hours: finding.rawHours,
    sourceIds: [finding.sourceId],
    sourceUrls: finding.sourceUrl ? [finding.sourceUrl] : [],
    firstSeenAt: now,
    lastSeenAt: now,
    enrichmentVersion: 0,
    qualityScore: 0,
    icpMatch: null,
    commercialSignals: {},
    metadata: {},
  };
}
