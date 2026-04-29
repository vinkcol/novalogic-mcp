// ─── Scraping Area — Canonical Schemas ───────────────────────

// ─── Source Definition ───────────────────────────────────────
export interface ScrapeSource {
  id: string;              // e.g. 'google-maps', 'paginas-amarillas', 'instagram'
  name: string;
  type: 'directory' | 'social' | 'marketplace' | 'web' | 'api';
  enabled: boolean;
  rateLimit: { requestsPerMinute: number; pauseBetweenPages: number };
  retryPolicy: { maxRetries: number; backoffMs: number };
  config: Record<string, any>;
}

// ─── Campaign ────────────────────────────────────────────────
export interface ScrapeCampaign {
  id?: number;
  name: string;
  sourceId: string;
  status: 'draft' | 'active' | 'paused' | 'completed' | 'failed';
  geography: CampaignGeography;
  categories: string[];
  queries: string[];
  priority: number;          // 0=low, 10=urgent
  maxPages: number;
  scheduling: { cronExpression?: string; runOnce?: boolean };
  metadata: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

export interface CampaignGeography {
  country: string;
  departments: string[];
  cities: string[];
}

// ─── Job ─────────────────────────────────────────────────────
export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ScrapeJob {
  id?: number;
  campaignId: number;
  sourceId: string;
  idempotencyKey: string;    // stable key: source+query+geo+cursor+timeWindow
  status: JobStatus;
  searchQuery: string;
  country: string;
  department: string;
  city: string;
  category: string;
  cursor: string | null;     // page number or token
  timeWindow: string;        // e.g. '2026-W13', '2026-03'
  findingsCount: number;
  prospectsCreated: number;
  prospectsMerged: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  metadata: Record<string, any>;
  createdAt?: string;
}

/** Generates stable idempotency key for a job */
export function buildJobKey(params: {
  sourceId: string;
  searchQuery: string;
  country: string;
  department: string;
  city: string;
  category: string;
  cursor: string | null;
  timeWindow: string;
}): string {
  const parts = [
    params.sourceId,
    params.searchQuery.toLowerCase().trim(),
    params.country.toLowerCase(),
    params.department.toLowerCase(),
    params.city.toLowerCase(),
    params.category.toLowerCase(),
    params.cursor || '0',
    params.timeWindow,
  ];
  return parts.join('|');
}

// ─── Raw Finding ─────────────────────────────────────────────
export interface RawFinding {
  id?: number;
  jobId: number;
  sourceId: string;
  rawBusinessName: string;
  rawAddress: string | null;
  rawPhone: string | null;
  rawEmail: string | null;
  rawWebsite: string | null;
  rawCategory: string | null;
  rawRating: number | null;
  rawReviewCount: number | null;
  rawHours: string | null;
  sourceUrl: string | null;
  rawPayload: Record<string, any>;
  createdAt?: string;
}

// ─── Prospect Record (canonical, normalized) ─────────────────
export interface ProspectRecord {
  id?: number;
  fingerprint: string;           // identity hash for dedup
  businessName: string;
  businessNameNormalized: string;
  phone: string | null;
  phoneNormalized: string | null;
  email: string | null;
  emailNormalized: string | null;
  website: string | null;
  domain: string | null;
  address: string | null;
  country: string;
  department: string;
  city: string;
  cityNormalized: string;
  category: string;
  categoryNormalized: string;
  rating: number | null;
  reviewCount: number | null;
  hours: string | null;
  sourceIds: string[];           // all sources that found this
  sourceUrls: string[];
  firstSeenAt: string;
  lastSeenAt: string;
  enrichmentVersion: number;
  qualityScore: number;          // 0-100
  icpMatch: string | null;       // 'high' | 'medium' | 'low' | null
  commercialSignals: Record<string, any>;
  metadata: Record<string, any>;
  createdAt?: string;
  updatedAt?: string;
}

// ─── Enrichment Snapshot ─────────────────────────────────────
export interface EnrichmentSnapshot {
  id?: number;
  prospectId: number;
  version: number;
  enrichmentType: string;       // 'geography' | 'category' | 'commercial' | 'icp' | 'quality'
  dataBefore: Record<string, any>;
  dataAfter: Record<string, any>;
  source: string;               // what triggered the enrichment
  createdAt?: string;
}

// ─── Sync Ledger ─────────────────────────────────────────────
export type SyncAction = 'created' | 'updated' | 'skipped' | 'failed';

export interface SyncLedger {
  id?: number;
  prospectId: number;
  crmDirectoryId: string | null; // UUID from CRM Directorio
  action: SyncAction;
  syncHash: string;              // hash of material fields sent
  materialChanges: string[];     // what changed: ['new_email', 'new_phone', ...]
  payload: Record<string, any>;  // what was sent to CRM
  responseData: Record<string, any>;
  createdAt?: string;
}

/** Fields that constitute a "material change" for sync purposes */
export const MATERIAL_CHANGE_FIELDS = [
  'email',
  'phone',
  'domain',
  'website',
  'qualityScore',
  'icpMatch',
  'category',
  'city',
  'department',
  'rating',
] as const;

// ─── Scrape Metrics ──────────────────────────────────────────
export interface ScrapeMetric {
  id?: number;
  sourceId: string;
  campaignId: number | null;
  metricType: string;   // 'job_completed' | 'job_failed' | 'findings_extracted' | 'prospects_created' | 'prospects_merged' | 'sync_created' | 'sync_updated' | 'sync_skipped'
  value: number;
  dimensions: Record<string, any>; // {city, department, category, query}
  createdAt?: string;
}

// ─── Connector Interface ─────────────────────────────────────
export interface ConnectorResult {
  findings: Omit<RawFinding, 'id' | 'jobId' | 'createdAt'>[];
  nextCursor: string | null;
  hasMore: boolean;
  metadata: Record<string, any>;
}

export interface SourceConnector {
  sourceId: string;
  sourceName: string;
  sourceType: ScrapeSource['type'];
  extract(params: ExtractionParams): Promise<ConnectorResult>;
}

export interface ExtractionParams {
  searchQuery: string;
  city: string;
  department: string;
  country: string;
  category: string;
  cursor: string | null;
  maxResults: number;
}
