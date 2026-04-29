/**
 * Base Connector
 * Provides shared utilities for all source connectors.
 * Each connector must implement SourceConnector interface.
 */
import type { SourceConnector, ExtractionParams, ConnectorResult, RawFinding } from '../schemas/index.js';

export abstract class BaseConnector implements SourceConnector {
  abstract sourceId: string;
  abstract sourceName: string;
  abstract sourceType: SourceConnector['sourceType'];

  // Rate limiting
  protected requestCount = 0;
  protected windowStart = Date.now();
  protected rateLimit = { requestsPerMinute: 10, pauseBetweenPages: 2000 };
  protected retryPolicy = { maxRetries: 3, backoffMs: 2000 };

  abstract extract(params: ExtractionParams): Promise<ConnectorResult>;

  // ─── Rate Limiting ───────────────────────────────────────

  protected async checkRateLimit(): Promise<void> {
    const now = Date.now();
    if (now - this.windowStart > 60000) {
      this.requestCount = 0;
      this.windowStart = now;
    }
    if (this.requestCount >= this.rateLimit.requestsPerMinute) {
      const waitMs = 60000 - (now - this.windowStart);
      if (waitMs > 0) await this.sleep(waitMs);
      this.requestCount = 0;
      this.windowStart = Date.now();
    }
    this.requestCount++;
  }

  protected async pauseBetweenPages(): Promise<void> {
    await this.sleep(this.rateLimit.pauseBetweenPages);
  }

  // ─── Retry Logic ─────────────────────────────────────────

  protected async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= this.retryPolicy.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err: any) {
        lastError = err;
        if (attempt < this.retryPolicy.maxRetries) {
          const delay = this.retryPolicy.backoffMs * Math.pow(2, attempt);
          await this.sleep(delay);
        }
      }
    }
    throw lastError;
  }

  // ─── Helpers ─────────────────────────────────────────────

  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  protected buildFinding(
    data: Partial<Omit<RawFinding, 'id' | 'jobId' | 'createdAt'>>,
  ): Omit<RawFinding, 'id' | 'jobId' | 'createdAt'> {
    return {
      sourceId: this.sourceId,
      rawBusinessName: data.rawBusinessName || '',
      rawAddress: data.rawAddress || null,
      rawPhone: data.rawPhone || null,
      rawEmail: data.rawEmail || null,
      rawWebsite: data.rawWebsite || null,
      rawCategory: data.rawCategory || null,
      rawRating: data.rawRating || null,
      rawReviewCount: data.rawReviewCount || null,
      rawHours: data.rawHours || null,
      sourceUrl: data.sourceUrl || null,
      rawPayload: data.rawPayload || {},
    };
  }
}
