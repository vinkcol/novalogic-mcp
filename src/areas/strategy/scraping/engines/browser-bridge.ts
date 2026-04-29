/**
 * Browser Bridge for Scraping
 * Lightweight Playwright wrapper for extraction jobs.
 * Independent from the QA browser session in operaciones/browser.
 */
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

interface ScrapingBrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  launchedAt: number;
}

let session: ScrapingBrowserSession | null = null;

// ─── Session Management ──────────────────────────────────────

export async function launchBrowser(options?: {
  headless?: boolean;
  viewportWidth?: number;
  viewportHeight?: number;
}): Promise<void> {
  if (session) {
    await closeBrowser();
  }

  const browser = await chromium.launch({
    headless: options?.headless ?? true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const context = await browser.newContext({
    viewport: {
      width: options?.viewportWidth || 1280,
      height: options?.viewportHeight || 800,
    },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();
  session = { browser, context, page, launchedAt: Date.now() };
}

export async function closeBrowser(): Promise<void> {
  if (session) {
    try { await session.browser.close(); } catch { /* ignore */ }
    session = null;
  }
}

function getPage(): Page {
  if (!session) throw new Error('Browser no activo. Llama launchBrowser() primero.');
  return session.page;
}

export function isActive(): boolean {
  return session !== null;
}

// ─── Navigation ──────────────────────────────────────────────

export async function navigate(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' = 'domcontentloaded'): Promise<{ url: string; title: string }> {
  const page = getPage();
  await page.goto(url, { waitUntil, timeout: 30000 });
  return { url: page.url(), title: await page.title() };
}

export async function waitForSelector(selector: string, timeout: number = 10000): Promise<void> {
  const page = getPage();
  await page.locator(selector).first().waitFor({ state: 'visible', timeout });
}

export async function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Scrolling (for infinite scroll pages like Google Maps) ──

export async function scrollInContainer(selector: string, iterations: number = 3, pauseMs: number = 2000): Promise<number> {
  const page = getPage();
  let previousHeight = 0;

  for (let i = 0; i < iterations; i++) {
    const currentHeight = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) {
        el.scrollTop = el.scrollHeight;
        return el.scrollHeight;
      }
      // Fallback: scroll window
      window.scrollTo(0, document.body.scrollHeight);
      return document.body.scrollHeight;
    }, selector);

    if (currentHeight === previousHeight) break; // no more content
    previousHeight = currentHeight;
    await waitMs(pauseMs);
  }

  return previousHeight;
}

// ─── DOM Extraction ──────────────────────────────────────────

export async function evaluate<T = any>(script: string): Promise<T> {
  const page = getPage();
  return page.evaluate(script);
}

export async function extractText(selector?: string): Promise<string> {
  const page = getPage();
  if (selector) {
    const el = page.locator(selector).first();
    return (await el.textContent()) || '';
  }
  return page.evaluate(() => document.body.innerText.substring(0, 10000));
}

// ─── Full Extraction Flow ────────────────────────────────────

export interface BrowserExtractionResult {
  data: any;
  pageUrl: string;
  pageTitle: string;
  elapsedMs: number;
}

/**
 * Executes a full browser extraction:
 * 1. Launch browser (if not active)
 * 2. Navigate to URL
 * 3. Wait for content
 * 4. Scroll to load more
 * 5. Extract via JS script
 * 6. Return results
 */
export async function executeExtraction(params: {
  url: string;
  waitSelector?: string;
  scrollSelector?: string;
  scrollIterations?: number;
  extractionScript: string;
  waitAfterLoad?: number;
}): Promise<BrowserExtractionResult> {
  const start = Date.now();

  if (!isActive()) {
    await launchBrowser({ headless: true });
  }

  const page = getPage();

  // Navigate
  await navigate(params.url);

  // Wait for content
  if (params.waitSelector) {
    try {
      await waitForSelector(params.waitSelector, 15000);
    } catch { /* content might load differently */ }
  }

  // Extra wait for dynamic content
  if (params.waitAfterLoad) {
    await waitMs(params.waitAfterLoad);
  }

  // Scroll to load more results
  if (params.scrollSelector && params.scrollIterations) {
    await scrollInContainer(params.scrollSelector, params.scrollIterations, 2500);
  }

  // Extract data
  const data = await evaluate(params.extractionScript);

  return {
    data,
    pageUrl: page.url(),
    pageTitle: await page.title(),
    elapsedMs: Date.now() - start,
  };
}
