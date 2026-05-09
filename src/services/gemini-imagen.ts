/**
 * Gemini Imagen Service — Image generation & editing via Google AI
 *
 * Two workflows:
 *   1. generateImage()      — text-to-image (Imagen 3 Generate)
 *   2. editWithReference()  — image+prompt → new image (Gemini Flash image I/O)
 *
 * Product photography pipeline:
 *   - generateProductShot()  — white bg, specific angle
 *   - generateLifestyleShot() — product in scene
 *   - generateSpecsShot()    — technical/detail view
 *   - runProductPipeline()   — all 5 shots in sequence
 */

import { GoogleGenAI, Modality } from "@google/genai";

const API_KEY = process.env.GOOGLE_API_KEY || process.env.GOOGLE_AI_API_KEY || "";

if (!API_KEY) {
  process.stderr.write("[gemini-imagen] WARNING: GOOGLE_AI_API_KEY not set\n");
} else {
  process.stderr.write("[gemini-imagen] Imagen service ready\n");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// ─── Types ────────────────────────────────────────────────────────────

export interface GeneratedImage {
  base64: string;
  mimeType: string;
  filename: string;
}

type AspectRatio = "1:1" | "16:9" | "9:16" | "4:3" | "3:4";

// ─── Text-to-Image (Imagen 3 Generate) ───────────────────────────────

export async function generateImage(
  prompt: string,
  options?: {
    aspectRatio?: AspectRatio;
    numberOfImages?: number;
  },
): Promise<GeneratedImage[]> {
  const response = await ai.models.generateImages({
    model: "imagen-4.0-generate-001",
    prompt,
    config: {
      numberOfImages: options?.numberOfImages || 1,
      aspectRatio: options?.aspectRatio || "1:1",
    },
  });

  if (!response.generatedImages || response.generatedImages.length === 0) {
    throw new Error("Imagen no genero resultados. Reformula el prompt.");
  }

  const ts = Date.now();
  return response.generatedImages.map((img, i) => ({
    base64: img.image!.imageBytes!,
    mimeType: "image/png",
    filename: `gen_${ts}_${i}.png`,
  }));
}

export async function generateAdImage(params: {
  productName: string;
  description?: string;
  style?: string;
  mood?: string;
  background?: string;
  aspectRatio?: AspectRatio;
  numberOfImages?: number;
  extraInstructions?: string;
}): Promise<GeneratedImage[]> {
  const parts: string[] = [
    `Professional advertising photography of "${params.productName}"`,
  ];
  if (params.description) parts.push(params.description);
  if (params.style) parts.push(`Style: ${params.style}`);
  if (params.mood) parts.push(`Mood: ${params.mood}`);
  if (params.background) parts.push(`Background: ${params.background}`);
  if (params.extraInstructions) parts.push(params.extraInstructions);
  parts.push(
    "High resolution, commercial quality, studio lighting, product-focused composition",
  );

  return generateImage(parts.join(". "), {
    aspectRatio: params.aspectRatio,
    numberOfImages: params.numberOfImages,
  });
}

// ─── Image Editing with Reference (Gemini Flash image I/O) ───────────
//
// Uses generateContent with image input + IMAGE response modality.
// This works with the Google AI API (no Vertex AI needed).
// Model: gemini-2.0-flash-exp-image-generation

export async function editWithReference(
  referenceBase64: string,
  prompt: string,
  options?: {
    subjectDescription?: string;
    numberOfImages?: number;
    mimeType?: string;
  },
): Promise<GeneratedImage[]> {
  const inputMime = options?.mimeType || "image/webp";
  const count = options?.numberOfImages || 1;
  const images: GeneratedImage[] = [];
  const ts = Date.now();

  for (let i = 0; i < count; i++) {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash-exp-image-generation",
      contents: [
        {
          role: "user",
          parts: [
            {
              inlineData: {
                mimeType: inputMime,
                data: referenceBase64,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
      config: {
        responseModalities: [Modality.IMAGE, Modality.TEXT],
      },
    });

    // Extract image from response parts
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts) {
        for (const part of candidate.content.parts) {
          if (part.inlineData && part.inlineData.data) {
            images.push({
              base64: part.inlineData.data,
              mimeType: part.inlineData.mimeType || "image/png",
              filename: `edit_${ts}_${i}.png`,
            });
          }
        }
      }
    }
  }

  if (images.length === 0) {
    throw new Error("Gemini Flash no genero imagenes. Intenta con otro prompt.");
  }

  return images;
}

// ─── Product Photography Pipeline ────────────────────────────────────

export type ProductView = "front" | "side" | "back";

const VIEW_PROMPTS: Record<ProductView, (name: string) => string> = {
  front: (name) =>
    `Generate a professional e-commerce product photo of this exact product (${name}). ` +
    `Show it from the FRONT view, centered on a pure white background. ` +
    `Professional studio lighting, subtle shadow below the product, ` +
    `Amazon/Shopify product listing style. High resolution, clean, commercial quality. ` +
    `Keep the product exactly as it appears in the reference image, only change the background and angle.`,
  side: (name) =>
    `Generate a professional e-commerce product photo of this exact product (${name}). ` +
    `Show it from the SIDE profile view (90 degrees), on a pure white background. ` +
    `Professional studio lighting showing the depth and profile of the product clearly. ` +
    `Subtle shadow, high resolution. ` +
    `Keep the product exactly as it appears in the reference image, only change the background and angle.`,
  back: (name) =>
    `Generate a professional e-commerce product photo of this exact product (${name}). ` +
    `Show the BACK/REAR of the product on a pure white background. ` +
    `Professional studio lighting showing any ports, buttons, or back details. ` +
    `High resolution, commercial quality. ` +
    `Keep the product exactly as it appears in the reference image, only change the background and angle.`,
};

export async function generateProductShot(
  referenceBase64: string,
  productName: string,
  view: ProductView,
  inputMimeType?: string,
): Promise<GeneratedImage[]> {
  const images = await editWithReference(
    referenceBase64,
    VIEW_PROMPTS[view](productName),
    { subjectDescription: productName, numberOfImages: 1, mimeType: inputMimeType },
  );
  images.forEach((img) => {
    img.filename = img.filename.replace("edit_", `product_${view}_`);
  });
  return images;
}

export async function generateLifestyleShot(
  referenceBase64: string,
  productName: string,
  scene?: string,
  inputMimeType?: string,
): Promise<GeneratedImage[]> {
  const defaultScene =
    "cozy living room with a happy pet being groomed, warm natural light streaming through window";
  const prompt =
    `Take this exact product (${productName}) from the reference image and place it in a lifestyle scene: ` +
    `${scene || defaultScene}. ` +
    `Realistic lifestyle advertising photography, shallow depth of field, ` +
    `warm color tones, aspirational and relatable setting, professional quality. ` +
    `The product must be clearly visible, in focus, and recognizable from the reference image.`;

  const images = await editWithReference(referenceBase64, prompt, {
    subjectDescription: productName,
    numberOfImages: 1,
    mimeType: inputMimeType,
  });
  images.forEach((img) => {
    img.filename = img.filename.replace("edit_", "lifestyle_");
  });
  return images;
}

export async function generateSpecsShot(
  referenceBase64: string,
  productName: string,
  specs?: string,
  inputMimeType?: string,
): Promise<GeneratedImage[]> {
  const specContext = specs ? ` Key features: ${specs}.` : "";
  const prompt =
    `Create a technical product documentation image of this exact product (${productName}).${specContext} ` +
    `Show the product from two angles (front and side) next to each other on a clean white background. ` +
    `Engineering catalog style, precise even lighting, every detail and component clearly visible. ` +
    `Professional technical photography style, high resolution. ` +
    `Keep the product exactly as it appears in the reference image.`;

  const images = await editWithReference(referenceBase64, prompt, {
    subjectDescription: productName,
    numberOfImages: 1,
    mimeType: inputMimeType,
  });
  images.forEach((img) => {
    img.filename = img.filename.replace("edit_", "specs_");
  });
  return images;
}

// ─── Full Pipeline ────────────────────────────────────────────────────

export interface PipelineResult {
  view: string;
  images: GeneratedImage[];
  error?: string;
}

export async function runProductPipeline(
  referenceBase64: string,
  productName: string,
  lifestyleScene?: string,
  specs?: string,
  inputMimeType?: string,
): Promise<PipelineResult[]> {
  const mime = inputMimeType;
  const tasks: Array<{ view: string; fn: () => Promise<GeneratedImage[]> }> = [
    { view: "front", fn: () => generateProductShot(referenceBase64, productName, "front", mime) },
    { view: "side", fn: () => generateProductShot(referenceBase64, productName, "side", mime) },
    { view: "back", fn: () => generateProductShot(referenceBase64, productName, "back", mime) },
    { view: "lifestyle", fn: () => generateLifestyleShot(referenceBase64, productName, lifestyleScene, mime) },
    { view: "specs", fn: () => generateSpecsShot(referenceBase64, productName, specs, mime) },
  ];

  const results: PipelineResult[] = [];

  // Run sequentially to respect rate limits
  for (const task of tasks) {
    try {
      process.stderr.write(`[gemini-imagen] Pipeline: generating ${task.view}...\n`);
      const images = await task.fn();
      results.push({ view: task.view, images });
      process.stderr.write(`[gemini-imagen] Pipeline: ${task.view} OK\n`);
    } catch (e: any) {
      process.stderr.write(`[gemini-imagen] Pipeline: ${task.view} FAILED — ${e.message}\n`);
      results.push({ view: task.view, images: [], error: e.message });
    }
  }

  return results;
}
