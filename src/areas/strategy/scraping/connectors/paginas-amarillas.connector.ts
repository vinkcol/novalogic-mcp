/**
 * Páginas Amarillas Colombia Connector
 * Extracts business listings from paginasamarillas.com.co
 * Second connector — demonstrates multi-source extensibility.
 */
import { BaseConnector } from './base.connector.js';
import * as browser from '../engines/browser-bridge.js';
import type { ExtractionParams, ConnectorResult } from '../schemas/index.js';

export class PaginasAmarillasConnector extends BaseConnector {
  sourceId = 'paginas-amarillas';
  sourceName = 'Páginas Amarillas Colombia';
  sourceType = 'directory' as const;

  constructor() {
    super();
    this.rateLimit = { requestsPerMinute: 8, pauseBetweenPages: 2000 };
    this.retryPolicy = { maxRetries: 3, backoffMs: 3000 };
  }

  async extract(params: ExtractionParams): Promise<ConnectorResult> {
    await this.checkRateLimit();

    const page = parseInt(params.cursor || '1') || 1;
    const query = encodeURIComponent(`${params.searchQuery} ${params.category}`);
    const city = encodeURIComponent(params.city);
    const url = `https://www.paginasamarillas.com.co/buscar/${query}/${city}?page=${page}`;

    const result = await this.withRetry(async () => {
      const extraction = await browser.executeExtraction({
        url,
        waitSelector: '.listing, .result-item, .business-card, article',
        waitAfterLoad: 1500,
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
        rawEmail: item.rawEmail,
        rawWebsite: item.rawWebsite,
        rawCategory: item.rawCategory || params.category,
        sourceUrl: item.sourceUrl,
        rawPayload: item,
      }));

    await this.pauseBetweenPages();

    return {
      findings,
      nextCursor: findings.length > 0 ? String(page + 1) : null,
      hasMore: findings.length > 0,
      metadata: { url, page, totalExtracted: result.parsed?.length || 0 },
    };
  }
}

// ─── DOM Extraction Script ───────────────────────────────────

const EXTRACTION_SCRIPT = `
(() => {
  const results = [];

  // Strategy 1: Standard listing cards
  const cards = document.querySelectorAll('.listing, .result-item, .business-card, article.result');
  cards.forEach(card => {
    try {
      const nameEl = card.querySelector('h2, h3, .business-name, .listing-name, .name a');
      const name = nameEl?.textContent?.trim();
      if (!name) return;

      const addressEl = card.querySelector('.address, .listing-address, .direccion, [itemprop="address"]');
      const phoneEl = card.querySelector('.phone, .listing-phone, .telefono, [itemprop="telephone"], a[href^="tel:"]');
      const emailEl = card.querySelector('a[href^="mailto:"]');
      const websiteEl = card.querySelector('a[href*="http"][rel="nofollow"], a.website, .sitio-web a');
      const categoryEl = card.querySelector('.category, .listing-category, .actividad, [itemprop="description"]');
      const linkEl = card.querySelector('a[href*="/empresa/"], a[href*="/negocio/"], h2 a, h3 a');

      results.push({
        rawBusinessName: name,
        rawAddress: addressEl?.textContent?.trim() || null,
        rawPhone: phoneEl?.textContent?.trim()?.replace(/\\s+/g, '') || phoneEl?.getAttribute('href')?.replace('tel:', '') || null,
        rawEmail: emailEl?.getAttribute('href')?.replace('mailto:', '') || null,
        rawWebsite: websiteEl?.getAttribute('href') || null,
        rawCategory: categoryEl?.textContent?.trim() || null,
        sourceUrl: linkEl?.getAttribute('href') || null,
      });
    } catch(e) { /* skip */ }
  });

  // Strategy 2: Fallback — structured data
  if (results.length === 0) {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(script => {
      try {
        const data = JSON.parse(script.textContent || '');
        const items = Array.isArray(data) ? data : [data];
        items.forEach(item => {
          if (item['@type'] === 'LocalBusiness' || item['@type'] === 'Organization') {
            results.push({
              rawBusinessName: item.name,
              rawAddress: item.address?.streetAddress || null,
              rawPhone: item.telephone || null,
              rawEmail: item.email || null,
              rawWebsite: item.url || null,
              rawCategory: item.description || null,
              sourceUrl: window.location.href,
            });
          }
        });
      } catch(e) { /* skip */ }
    });
  }

  return JSON.stringify(results);
})()
`;

export const paginasAmarillasConnector = new PaginasAmarillasConnector();
