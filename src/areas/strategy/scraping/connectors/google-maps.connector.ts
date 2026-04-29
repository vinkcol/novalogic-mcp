/**
 * Google Maps Connector
 * Extracts business listings from Google Maps via Playwright browser.
 * Strategy: DOM-first extraction with scroll pagination.
 */
import { BaseConnector } from './base.connector.js';
import * as browser from '../engines/browser-bridge.js';
import type { ExtractionParams, ConnectorResult } from '../schemas/index.js';

export class GoogleMapsConnector extends BaseConnector {
  sourceId = 'google-maps';
  sourceName = 'Google Maps';
  sourceType = 'directory' as const;

  constructor() {
    super();
    this.rateLimit = { requestsPerMinute: 5, pauseBetweenPages: 3000 };
    this.retryPolicy = { maxRetries: 2, backoffMs: 5000 };
  }

  async extract(params: ExtractionParams): Promise<ConnectorResult> {
    await this.checkRateLimit();

    const searchTerm = `${params.searchQuery} ${params.category} en ${params.city}, ${params.department}`;
    const url = `https://www.google.com/maps/search/${encodeURIComponent(searchTerm)}`;
    const scrollIterations = parseInt(params.cursor || '0') || 3;

    const result = await this.withRetry(async () => {
      const extraction = await browser.executeExtraction({
        url,
        waitSelector: '[role="feed"]',
        scrollSelector: '[role="feed"]',
        scrollIterations,
        waitAfterLoad: 2000,
        extractionScript: EXTRACTION_SCRIPT,
      });

      let parsed: any[] = [];
      try {
        parsed = typeof extraction.data === 'string' ? JSON.parse(extraction.data) : extraction.data;
      } catch { parsed = []; }

      return { parsed, pageUrl: extraction.pageUrl };
    });

    const findings = (result.parsed || [])
      .filter((item: any) => item.rawBusinessName)
      .slice(0, params.maxResults)
      .map((item: any) => this.buildFinding({
        rawBusinessName: item.rawBusinessName,
        rawAddress: item.rawAddress,
        rawPhone: item.rawPhone,
        rawEmail: item.rawEmail || null,
        rawWebsite: item.rawWebsite,
        rawCategory: item.rawCategory,
        rawRating: item.rawRating,
        rawReviewCount: item.rawReviewCount,
        rawHours: item.rawHours,
        sourceUrl: item.sourceUrl,
        rawPayload: item,
      }));

    await this.pauseBetweenPages();

    return {
      findings,
      nextCursor: findings.length >= params.maxResults ? String(scrollIterations + 2) : null,
      hasMore: findings.length >= params.maxResults,
      metadata: { url, searchTerm, totalExtracted: result.parsed?.length || 0 },
    };
  }
}

// ─── DOM Extraction Script ───────────────────────────────────

const EXTRACTION_SCRIPT = `
(() => {
  const results = [];
  const cards = document.querySelectorAll('[role="feed"] > div > div > a[href*="/maps/place/"]');

  cards.forEach(card => {
    try {
      const container = card.closest('[role="feed"] > div > div');
      if (!container) return;

      const nameEl = container.querySelector('.fontHeadlineSmall, .qBF1Pd');
      const ratingEl = container.querySelector('.MW4etd');
      const reviewCountEl = container.querySelector('.UY7F9');
      const categoryEl = container.querySelector('.W4Efsd:nth-child(2) > .W4Efsd > span:first-child');
      const addressEl = container.querySelector('.W4Efsd:nth-child(2) > .W4Efsd > span:last-child');
      const phoneEl = container.querySelector('[data-tooltip*="phone"], .UsdlK');
      const websiteLink = container.querySelector('a[data-value="Website"]');
      const hoursEl = container.querySelector('.W4Efsd:nth-child(3)');

      const name = nameEl?.textContent?.trim();
      if (!name) return;

      results.push({
        rawBusinessName: name,
        rawRating: ratingEl ? parseFloat(ratingEl.textContent) : null,
        rawReviewCount: reviewCountEl ? parseInt(reviewCountEl.textContent.replace(/[^0-9]/g, '')) : null,
        rawCategory: categoryEl?.textContent?.trim() || null,
        rawAddress: addressEl?.textContent?.trim()?.replace(/^· /, '') || null,
        rawPhone: phoneEl?.textContent?.trim() || null,
        rawWebsite: websiteLink?.getAttribute('href') || null,
        rawHours: hoursEl?.textContent?.trim() || null,
        sourceUrl: card.getAttribute('href') || null,
      });
    } catch(e) { /* skip malformed card */ }
  });

  return JSON.stringify(results);
})()
`;

export const googleMapsConnector = new GoogleMapsConnector();
