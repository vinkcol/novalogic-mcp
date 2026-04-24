/**
 * OCR Service
 *
 * Processes browser screenshots into structured data using:
 * - sharp: image analysis (dimensions, dominant colors, regions)
 * - tesseract.js: text extraction with bounding boxes and confidence
 *
 * Returns compact JSON instead of base64 images, solving the token limit issue.
 */

import sharp from 'sharp';
import Tesseract, { type Block, type Line as TesseractLine } from 'tesseract.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TextBlock {
  text: string;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  line: number;
}

export interface ColorRegion {
  color: string; // hex
  percentage: number;
  position: 'top' | 'middle' | 'bottom' | 'left' | 'right' | 'center';
}

export interface LayoutRegion {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  dominantColor: string;
  hasText: boolean;
}

export interface DomElement {
  tag: string;
  text: string;
  type?: string;
  id?: string;
  placeholder?: string;
  role?: string;
  testId?: string;
  href?: string;
  disabled?: boolean;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface OcrResult {
  page_info: {
    width: number;
    height: number;
    format: string;
    fileSize: string;
  };
  text_blocks: TextBlock[];
  dom_elements: DomElement[];
  full_text: string;
  colors: ColorRegion[];
  layout_regions: LayoutRegion[];
  stats: {
    total_words: number;
    avg_confidence: number;
    processing_time_ms: number;
    dom_elements_count: number;
    text_source: 'ocr' | 'dom' | 'hybrid';
  };
}

// ---------------------------------------------------------------------------
// OCR Service
// ---------------------------------------------------------------------------

let worker: Tesseract.Worker | null = null;

async function getWorker(): Promise<Tesseract.Worker> {
  if (!worker) {
    worker = await Tesseract.createWorker('spa+eng', undefined, {
      // Suppress noisy logs
    });
  }
  return worker;
}

/**
 * Analyze dominant colors by sampling regions of the image
 */
async function analyzeColors(buffer: Buffer, width: number, height: number): Promise<ColorRegion[]> {
  const regions: { name: ColorRegion['position']; top: number; left: number; w: number; h: number }[] = [
    { name: 'top', top: 0, left: 0, w: width, h: Math.floor(height * 0.2) },
    { name: 'middle', top: Math.floor(height * 0.35), left: 0, w: width, h: Math.floor(height * 0.3) },
    { name: 'bottom', top: Math.floor(height * 0.8), left: 0, w: width, h: Math.floor(height * 0.2) },
    { name: 'left', top: 0, left: 0, w: Math.floor(width * 0.2), h: height },
    { name: 'right', top: 0, left: Math.floor(width * 0.8), w: Math.floor(width * 0.2), h: height },
  ];

  const results: ColorRegion[] = [];

  for (const region of regions) {
    try {
      const extracted = sharp(buffer).extract({
        top: region.top,
        left: region.left,
        width: Math.max(1, region.w),
        height: Math.max(1, region.h),
      });

      // Resize to 1x1 to get the average/dominant color
      const { data, info } = await extracted.resize(1, 1).raw().toBuffer({ resolveWithObject: true });

      if (info.channels >= 3) {
        const hex = `#${data[0].toString(16).padStart(2, '0')}${data[1].toString(16).padStart(2, '0')}${data[2].toString(16).padStart(2, '0')}`;
        results.push({
          color: hex,
          percentage: 100, // single dominant color per region
          position: region.name,
        });
      }
    } catch {
      // Skip regions that fail (e.g. out of bounds)
    }
  }

  return results;
}

/**
 * Divide the image into a grid and analyze each cell for layout detection
 */
async function analyzeLayout(
  buffer: Buffer,
  width: number,
  height: number,
  textBlocks: TextBlock[],
): Promise<LayoutRegion[]> {
  const cols = 3;
  const rows = 3;
  const cellW = Math.floor(width / cols);
  const cellH = Math.floor(height / rows);
  const labels = [
    ['top-left', 'top-center', 'top-right'],
    ['mid-left', 'center', 'mid-right'],
    ['bot-left', 'bot-center', 'bot-right'],
  ];

  const regions: LayoutRegion[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cellW;
      const y = r * cellH;

      try {
        const { data } = await sharp(buffer)
          .extract({ top: y, left: x, width: cellW, height: cellH })
          .resize(1, 1)
          .raw()
          .toBuffer({ resolveWithObject: true });

        const hex = `#${data[0].toString(16).padStart(2, '0')}${data[1].toString(16).padStart(2, '0')}${data[2].toString(16).padStart(2, '0')}`;

        // Check if any text block overlaps this cell
        const hasText = textBlocks.some(
          (tb) =>
            tb.x < x + cellW && tb.x + tb.width > x &&
            tb.y < y + cellH && tb.y + tb.height > y,
        );

        regions.push({
          name: labels[r][c],
          x, y,
          width: cellW,
          height: cellH,
          dominantColor: hex,
          hasText,
        });
      } catch {
        // skip
      }
    }
  }

  return regions;
}

/**
 * Main OCR processing function.
 * Takes a PNG buffer and returns structured data.
 */
export async function processScreenshot(
  buffer: Buffer,
  options?: {
    minConfidence?: number; // filter text below this confidence (0-100, default 30)
    includeLayout?: boolean; // analyze layout regions (default true)
    includeColors?: boolean; // analyze colors (default true)
    scale?: number; // scale factor for OCR accuracy (default 1, max 2)
    domElements?: DomElement[]; // DOM elements from Playwright for hybrid analysis
    domText?: string; // visible text from DOM (page.innerText)
  },
): Promise<OcrResult> {
  const startTime = Date.now();
  const minConfidence = options?.minConfidence ?? 30;
  const includeLayout = options?.includeLayout !== false;
  const includeColors = options?.includeColors !== false;

  // 1. Get image metadata
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width || 1280;
  const height = metadata.height || 720;

  // 2. Optionally scale up for better OCR accuracy
  let ocrBuffer = buffer;
  let scaleX = 1;
  let scaleY = 1;
  const scale = Math.min(options?.scale || 1, 2);
  if (scale > 1) {
    ocrBuffer = await sharp(buffer)
      .resize(Math.round(width * scale), Math.round(height * scale))
      .toBuffer();
    scaleX = 1 / scale;
    scaleY = 1 / scale;
  }

  // 3. Run Tesseract OCR
  const ocrWorker = await getWorker();
  const { data } = await ocrWorker.recognize(ocrBuffer);

  // 4. Extract text blocks from blocks → paragraphs → lines
  const textBlocks: TextBlock[] = [];
  let lineIndex = 0;

  const blocks: Block[] = data.blocks || [];
  for (const block of blocks) {
    for (const paragraph of block.paragraphs || []) {
      for (const line of (paragraph.lines || []) as TesseractLine[]) {
        const lineText = line.text?.trim();
        if (!lineText) continue;

        const lineConf = line.confidence || 0;
        if (lineConf < minConfidence) continue;

        const bbox = line.bbox;
        textBlocks.push({
          text: lineText,
          confidence: Math.round(lineConf * 10) / 10,
          x: Math.round((bbox?.x0 || 0) * scaleX),
          y: Math.round((bbox?.y0 || 0) * scaleY),
          width: Math.round(((bbox?.x1 || 0) - (bbox?.x0 || 0)) * scaleX),
          height: Math.round(((bbox?.y1 || 0) - (bbox?.y0 || 0)) * scaleY),
          line: lineIndex,
        });
        lineIndex++;
      }
    }
  }

  // 5. Analyze colors
  const colors = includeColors ? await analyzeColors(buffer, width, height) : [];

  // 6. Analyze layout
  const layoutRegions = includeLayout ? await analyzeLayout(buffer, width, height, textBlocks) : [];

  // 7. Integrate DOM elements
  const domElements = options?.domElements || [];
  const domText = options?.domText || '';

  // 8. Compile full text — prefer DOM text if OCR found nothing
  const ocrText = textBlocks.map((b) => b.text).join('\n');
  const fullText = ocrText || domText;
  const textSource: 'ocr' | 'dom' | 'hybrid' =
    ocrText && domText ? 'hybrid' : ocrText ? 'ocr' : 'dom';

  // 9. Update layout hasText using DOM elements when OCR found no text
  if (textBlocks.length === 0 && domElements.length > 0) {
    for (const region of layoutRegions) {
      region.hasText = domElements.some(
        (el) =>
          el.text &&
          el.x < region.x + region.width && el.x + el.width > region.x &&
          el.y < region.y + region.height && el.y + el.height > region.y,
      );
    }
  }

  // 10. Stats
  const allTextForWords = fullText || '';
  const totalWords = allTextForWords.trim() ? allTextForWords.trim().split(/\s+/).length : 0;
  const avgConfidence =
    textBlocks.length > 0
      ? Math.round((textBlocks.reduce((sum, b) => sum + b.confidence, 0) / textBlocks.length) * 10) / 10
      : 0;

  return {
    page_info: {
      width,
      height,
      format: metadata.format || 'png',
      fileSize: `${(buffer.length / 1024).toFixed(1)}KB`,
    },
    text_blocks: textBlocks,
    dom_elements: domElements,
    full_text: fullText,
    colors,
    layout_regions: layoutRegions,
    stats: {
      total_words: totalWords,
      avg_confidence: avgConfidence,
      dom_elements_count: domElements.length,
      text_source: textSource,
      processing_time_ms: Date.now() - startTime,
    },
  };
}

/**
 * Cleanup: terminate the Tesseract worker
 */
export async function terminateOcr(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}
