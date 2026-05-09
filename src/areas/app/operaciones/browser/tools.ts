/**
 * Browser Agent Tools
 *
 * Provides browser automation tools using Playwright for testing
 * application flows (login, POS, inventory, etc.).
 *
 * Tools:
 *   - browser_launch    — Start a browser session
 *   - browser_navigate  — Navigate to a URL or app route
 *   - browser_action    — Perform actions (click, fill, select, check, hover)
 *   - browser_screenshot— Take a screenshot (returns base64 image)
 *   - browser_get_state — Get current page info (URL, title, elements)
 *   - browser_evaluate  — Execute JavaScript in page context
 *   - browser_wait      — Wait for selector, navigation, or timeout
 *   - browser_run_flow  — Run a sequence of steps as a test flow
 *   - browser_close     — Close the browser session
 */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { processScreenshot, terminateOcr } from '../../../../services/ocr.service.js';

// ---------------------------------------------------------------------------
// Session management — single browser session at a time
// ---------------------------------------------------------------------------
interface BrowserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  launchedAt: string;
  baseUrl: string;
}

let session: BrowserSession | null = null;

function getSession(): BrowserSession {
  if (!session) {
    throw new Error('No hay sesión de browser activa. Usa browser_launch primero.');
  }
  return session;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const APP_DEFAULTS = {
  dashboardUrl: 'http://localhost:3000',
  apiUrl: 'http://localhost:5007',
};

async function takeScreenshot(page: Page, fullPage = false): Promise<string> {
  const buffer = await page.screenshot({ fullPage, type: 'png' });
  return buffer.toString('base64');
}

async function getPageInfo(page: Page) {
  return {
    url: page.url(),
    title: await page.title(),
    viewport: page.viewportSize(),
  };
}

async function getVisibleElements(page: Page, selector?: string) {
  const sel = selector || 'button, a, input, select, textarea, [role="button"], [data-testid]';
  return page.evaluate((s) => {
    const els = document.querySelectorAll(s);
    return Array.from(els).slice(0, 50).map((el) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return {
        tag: el.tagName.toLowerCase(),
        text: (el as HTMLElement).innerText?.slice(0, 100) || '',
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
        role: el.getAttribute('role') || '',
        testId: el.getAttribute('data-testid') || '',
        href: el.getAttribute('href') || '',
        disabled: (el as HTMLInputElement).disabled || false,
      };
    }).filter(Boolean);
  }, sel);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------
export const tools: Record<string, any> = {

  // =========================================================================
  // browser_launch
  // =========================================================================
  browser_launch: {
    description: '[Browser Agent] Lanza una sesión de browser (Chromium) para testing. Opcionalmente navega a una URL inicial.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL inicial (default: http://localhost:3000)',
        },
        headless: {
          type: 'boolean',
          description: 'Ejecutar sin ventana visible (default: true)',
        },
        viewport_width: {
          type: 'number',
          description: 'Ancho del viewport (default: 1280)',
        },
        viewport_height: {
          type: 'number',
          description: 'Alto del viewport (default: 720)',
        },
      },
    },
    handler: async (args: any) => {
      // Close existing session if any
      if (session) {
        try { await session.browser.close(); } catch {}
        session = null;
      }

      const headless = args.headless !== false; // default true
      const width = args.viewport_width || 1280;
      const height = args.viewport_height || 720;
      const baseUrl = args.url || APP_DEFAULTS.dashboardUrl;

      const browser = await chromium.launch({
        executablePath: '/usr/bin/google-chrome-stable',
        headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const context = await browser.newContext({
        viewport: { width, height },
        locale: 'es-ES',
        timezoneId: 'America/Bogota',
      });

      const page = await context.newPage();

      // Navigate to initial URL
      try {
        await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (e: any) {
        // Don't fail launch if URL is unreachable
      }

      session = {
        browser,
        context,
        page,
        launchedAt: new Date().toISOString(),
        baseUrl,
      };

      const info = await getPageInfo(page);
      return {
        success: true,
        message: `Browser lanzado (headless: ${headless})`,
        ...info,
        baseUrl,
      };
    },
  },

  // =========================================================================
  // browser_navigate
  // =========================================================================
  browser_navigate: {
    description: '[Browser Agent] Navega a una URL o ruta de la aplicación. Si la ruta empieza con "/" se usa como path relativo al baseUrl.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'URL completa o ruta relativa (ej: "/empresa/pos", "/acceso")',
        },
        wait_until: {
          type: 'string',
          enum: ['load', 'domcontentloaded', 'networkidle', 'commit'],
          description: 'Evento de espera (default: domcontentloaded)',
        },
      },
      required: ['url'],
    },
    handler: async (args: any) => {
      const s = getSession();
      let targetUrl = args.url;

      // Resolve relative paths
      if (targetUrl.startsWith('/')) {
        targetUrl = s.baseUrl.replace(/\/$/, '') + targetUrl;
      }

      const waitUntil = args.wait_until || 'domcontentloaded';
      await s.page.goto(targetUrl, { waitUntil, timeout: 15000 });

      const info = await getPageInfo(s.page);
      return { success: true, ...info };
    },
  },

  // =========================================================================
  // browser_action
  // =========================================================================
  browser_action: {
    description: '[Browser Agent] Ejecuta una acción en la página: click, fill, select, check, uncheck, hover, press, clear.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['click', 'fill', 'select', 'check', 'uncheck', 'hover', 'press', 'clear', 'dblclick'],
          description: 'Tipo de acción',
        },
        selector: {
          type: 'string',
          description: 'Selector CSS o texto del elemento (ej: "#login-btn", "text=Iniciar sesión", "button:has-text(\\"Guardar\\")")',
        },
        value: {
          type: 'string',
          description: 'Valor para fill/select/press (ej: texto, valor de option, tecla)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout en ms (default: 5000)',
        },
      },
      required: ['action', 'selector'],
    },
    handler: async (args: any) => {
      const s = getSession();
      const { action, selector, value, timeout = 5000 } = args;

      const locator = s.page.locator(selector).first();
      await locator.waitFor({ state: 'visible', timeout });

      switch (action) {
        case 'click':
          await locator.click({ timeout });
          break;
        case 'dblclick':
          await locator.dblclick({ timeout });
          break;
        case 'fill':
          await locator.fill(value || '', { timeout });
          break;
        case 'select':
          await locator.selectOption(value || '', { timeout });
          break;
        case 'check':
          await locator.check({ timeout });
          break;
        case 'uncheck':
          await locator.uncheck({ timeout });
          break;
        case 'hover':
          await locator.hover({ timeout });
          break;
        case 'press':
          await locator.press(value || 'Enter', { timeout });
          break;
        case 'clear':
          await locator.clear({ timeout });
          break;
        default:
          throw new Error(`Acción desconocida: ${action}`);
      }

      // Brief wait for any UI updates
      await s.page.waitForTimeout(300);

      const info = await getPageInfo(s.page);
      return { success: true, action, selector, ...info };
    },
  },

  // =========================================================================
  // browser_screenshot
  // =========================================================================
  browser_screenshot: {
    description: '[Browser Agent] Toma un screenshot de la página actual. Retorna la imagen en base64.',
    inputSchema: {
      type: 'object',
      properties: {
        full_page: {
          type: 'boolean',
          description: 'Capturar la página completa con scroll (default: false)',
        },
        selector: {
          type: 'string',
          description: 'Selector CSS para capturar solo un elemento específico',
        },
      },
    },
    handler: async (args: any) => {
      const s = getSession();

      let buffer: Buffer;
      if (args.selector) {
        const element = s.page.locator(args.selector).first();
        buffer = await element.screenshot({ type: 'png' });
      } else {
        buffer = await s.page.screenshot({
          fullPage: args.full_page || false,
          type: 'png',
        });
      }

      const base64 = buffer.toString('base64');
      const info = await getPageInfo(s.page);

      return {
        content: [
          {
            type: 'image',
            data: base64,
            mimeType: 'image/png',
          },
          {
            type: 'text',
            text: JSON.stringify({ ...info, size: `${(buffer.length / 1024).toFixed(1)}KB` }),
          },
        ],
      };
    },
  },

  // =========================================================================
  // browser_get_state
  // =========================================================================
  browser_get_state: {
    description: '[Browser Agent] Obtiene el estado actual de la página: URL, título, elementos interactivos visibles, y opcionalmente el texto visible.',
    inputSchema: {
      type: 'object',
      properties: {
        include_text: {
          type: 'boolean',
          description: 'Incluir texto visible de la página (default: false)',
        },
        selector: {
          type: 'string',
          description: 'Filtrar elementos visibles por selector CSS',
        },
      },
    },
    handler: async (args: any) => {
      const s = getSession();
      const info = await getPageInfo(s.page);
      const elements = await getVisibleElements(s.page, args.selector);

      const result: any = { ...info, elements };

      if (args.include_text) {
        result.text = await s.page.evaluate(() => {
          return document.body?.innerText?.slice(0, 5000) || '';
        });
      }

      return result;
    },
  },

  // =========================================================================
  // browser_evaluate
  // =========================================================================
  browser_evaluate: {
    description: '[Browser Agent] Ejecuta JavaScript en el contexto de la página. Útil para inspeccionar el DOM, Redux store, localStorage, etc.',
    inputSchema: {
      type: 'object',
      properties: {
        script: {
          type: 'string',
          description: 'Código JavaScript a ejecutar (se evalúa como expresión). Ej: "document.title", "localStorage.getItem(\'token\')"',
        },
      },
      required: ['script'],
    },
    handler: async (args: any) => {
      const s = getSession();
      const result = await s.page.evaluate(args.script);
      return { success: true, result };
    },
  },

  // =========================================================================
  // browser_wait
  // =========================================================================
  browser_wait: {
    description: '[Browser Agent] Espera a que se cumpla una condición: selector visible, URL cambie, o timeout.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['selector', 'url', 'timeout', 'hidden'],
          description: 'Tipo de espera',
        },
        value: {
          type: 'string',
          description: 'Selector CSS, patrón de URL, o ms para timeout',
        },
        timeout: {
          type: 'number',
          description: 'Timeout máximo en ms (default: 10000)',
        },
      },
      required: ['type', 'value'],
    },
    handler: async (args: any) => {
      const s = getSession();
      const { type, value, timeout = 10000 } = args;

      switch (type) {
        case 'selector':
          await s.page.locator(value).first().waitFor({ state: 'visible', timeout });
          break;
        case 'hidden':
          await s.page.locator(value).first().waitFor({ state: 'hidden', timeout });
          break;
        case 'url':
          await s.page.waitForURL(value, { timeout });
          break;
        case 'timeout':
          await s.page.waitForTimeout(parseInt(value) || 1000);
          break;
      }

      const info = await getPageInfo(s.page);
      return { success: true, waited_for: type, value, ...info };
    },
  },

  // =========================================================================
  // browser_run_flow
  // =========================================================================
  browser_run_flow: {
    description: `[Browser Agent] Ejecuta un flujo de test como una secuencia de pasos. Cada paso es un objeto con: action, selector, value, wait_after (ms).
Ejemplo de steps: [{"action":"navigate","value":"/acceso"},{"action":"fill","selector":"#email","value":"admin@test.com"},{"action":"click","selector":"button[type=submit]"},{"action":"wait","value":"selector","selector":".dashboard"}]
Acciones soportadas: navigate, click, fill, select, check, press, wait, screenshot, evaluate.`,
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Nombre descriptivo del flujo (ej: "Login admin", "Crear venta POS")',
        },
        steps: {
          type: 'array',
          description: 'Secuencia de pasos a ejecutar',
          items: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['navigate', 'click', 'fill', 'select', 'check', 'press', 'wait', 'screenshot', 'evaluate'],
              },
              selector: { type: 'string' },
              value: { type: 'string' },
              wait_after: { type: 'number', description: 'ms a esperar después del paso' },
            },
            required: ['action'],
          },
        },
        stop_on_error: {
          type: 'boolean',
          description: 'Detener al primer error (default: true)',
        },
      },
      required: ['name', 'steps'],
    },
    handler: async (args: any) => {
      const s = getSession();
      const { name, steps, stop_on_error = true } = args;
      const results: any[] = [];
      const startTime = Date.now();

      for (let i = 0; i < steps.length; i++) {
        const step = steps[i];
        const stepResult: any = { step: i + 1, action: step.action, status: 'ok' };

        try {
          switch (step.action) {
            case 'navigate': {
              let url = step.value || step.selector;
              if (url.startsWith('/')) {
                url = s.baseUrl.replace(/\/$/, '') + url;
              }
              await s.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
              break;
            }
            case 'click':
              await s.page.locator(step.selector).first().click({ timeout: 5000 });
              break;
            case 'fill':
              await s.page.locator(step.selector).first().fill(step.value || '', { timeout: 5000 });
              break;
            case 'select':
              await s.page.locator(step.selector).first().selectOption(step.value || '', { timeout: 5000 });
              break;
            case 'check':
              await s.page.locator(step.selector).first().check({ timeout: 5000 });
              break;
            case 'press':
              await s.page.locator(step.selector).first().press(step.value || 'Enter', { timeout: 5000 });
              break;
            case 'wait':
              if (step.value === 'selector' && step.selector) {
                await s.page.locator(step.selector).first().waitFor({ state: 'visible', timeout: 10000 });
              } else if (step.value) {
                await s.page.waitForTimeout(parseInt(step.value) || 1000);
              }
              break;
            case 'screenshot': {
              const buf = await s.page.screenshot({ type: 'png' });
              stepResult.screenshot = buf.toString('base64').slice(0, 100) + '...';
              stepResult.screenshot_size = `${(buf.length / 1024).toFixed(1)}KB`;
              break;
            }
            case 'evaluate':
              stepResult.eval_result = await s.page.evaluate(step.value || '');
              break;
          }

          stepResult.url = s.page.url();

          if (step.wait_after) {
            await s.page.waitForTimeout(step.wait_after);
          }
        } catch (e: any) {
          stepResult.status = 'error';
          stepResult.error = e.message;
          results.push(stepResult);
          if (stop_on_error) break;
          continue;
        }

        results.push(stepResult);
      }

      const elapsed = Date.now() - startTime;
      const passed = results.filter((r) => r.status === 'ok').length;
      const failed = results.filter((r) => r.status === 'error').length;
      const info = await getPageInfo(s.page);

      return {
        flow: name,
        total_steps: steps.length,
        executed: results.length,
        passed,
        failed,
        elapsed_ms: elapsed,
        status: failed === 0 ? 'PASSED' : 'FAILED',
        steps: results,
        final_state: info,
      };
    },
  },

  // =========================================================================
  // browser_ocr
  // =========================================================================
  browser_ocr: {
    description: '[Browser Agent] Toma un screenshot y lo procesa con OCR. Retorna texto estructurado con coordenadas, colores y layout en vez de base64 (evita exceder límites de tokens).',
    inputSchema: {
      type: 'object',
      properties: {
        full_page: {
          type: 'boolean',
          description: 'Capturar la página completa con scroll (default: false)',
        },
        selector: {
          type: 'string',
          description: 'Selector CSS para capturar solo un elemento específico',
        },
        min_confidence: {
          type: 'number',
          description: 'Confianza mínima para incluir texto (0-100, default: 30)',
        },
        include_layout: {
          type: 'boolean',
          description: 'Incluir análisis de layout por regiones (default: true)',
        },
        include_colors: {
          type: 'boolean',
          description: 'Incluir análisis de colores dominantes (default: true)',
        },
        scale: {
          type: 'number',
          description: 'Factor de escala para mejorar precisión OCR (1-2, default: 1)',
        },
      },
    },
    handler: async (args: any) => {
      const s = getSession();

      // Take screenshot as buffer (NOT base64)
      let buffer: Buffer;
      if (args.selector) {
        const element = s.page.locator(args.selector).first();
        buffer = await element.screenshot({ type: 'png' });
      } else {
        buffer = await s.page.screenshot({
          fullPage: args.full_page || false,
          type: 'png',
        });
      }

      // Extract DOM elements with bounding boxes for hybrid analysis
      const domElements = await s.page.evaluate(() => {
        const sel = 'button, a, input, select, textarea, h1, h2, h3, h4, h5, h6, p, span, label, td, th, li, [role="button"], [role="tab"], [role="menuitem"], [data-testid]';
        const els = document.querySelectorAll(sel);
        return Array.from(els).slice(0, 100).map((el) => {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) return null;
          const text = (el as HTMLElement).innerText?.slice(0, 200)?.trim() || '';
          if (!text && !el.getAttribute('placeholder')) return null;
          return {
            tag: el.tagName.toLowerCase(),
            text,
            type: el.getAttribute('type') || undefined,
            id: el.id || undefined,
            placeholder: el.getAttribute('placeholder') || undefined,
            role: el.getAttribute('role') || undefined,
            testId: el.getAttribute('data-testid') || undefined,
            href: el.getAttribute('href') || undefined,
            disabled: (el as HTMLInputElement).disabled || false,
            x: Math.round(rect.x),
            y: Math.round(rect.y),
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        }).filter(Boolean);
      });

      // Get visible text from DOM
      const domText = await s.page.evaluate(() => document.body.innerText?.slice(0, 3000) || '');

      // Process with OCR service (hybrid: image analysis + DOM data)
      const result = await processScreenshot(buffer, {
        minConfidence: args.min_confidence,
        includeLayout: args.include_layout,
        includeColors: args.include_colors,
        scale: args.scale,
        domElements: domElements as any[],
        domText,
      });

      // Add page context
      const info = await getPageInfo(s.page);

      return {
        ...result,
        page_info: {
          ...result.page_info,
          url: info.url,
          title: info.title,
          viewport: info.viewport,
        },
      };
    },
  },

  // =========================================================================
  // browser_close
  // =========================================================================
  browser_close: {
    description: '[Browser Agent] Cierra la sesión de browser activa y libera recursos.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    handler: async () => {
      if (!session) {
        await terminateOcr();
        return { success: true, message: 'No había sesión activa.' };
      }

      const duration = Date.now() - new Date(session.launchedAt).getTime();
      await session.browser.close();
      session = null;
      await terminateOcr();

      return {
        success: true,
        message: 'Browser cerrado.',
        session_duration_ms: duration,
      };
    },
  },
};
