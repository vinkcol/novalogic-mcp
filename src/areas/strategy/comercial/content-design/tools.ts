/**
 * Content Design Agent — AI image generation & product photography pipeline
 *
 * Workflows:
 *   A. Text-to-image (prompt only)        → content_design_generate, content_design_generate_ad
 *   B. Reference-based editing            → content_design_edit
 *   C. Product photography pipeline       → content_design_product_shots, content_design_lifestyle,
 *                                           content_design_specs_shot, content_design_full_pipeline
 *   D. Upload to ecommerce                → content_design_upload_to_product, content_design_generate_and_upload
 */

import {
  generateImage,
  generateAdImage,
  editWithReference,
  generateProductShot,
  generateLifestyleShot,
  generateSpecsShot,
  runProductPipeline,
} from "../../../../services/gemini-imagen.js";
import type { GeneratedImage } from "../../../../services/gemini-imagen.js";
import { api } from "../../../../services/api-client.js";

function err(message: string) { return { error: message }; }
function ok(data: any, message?: string) { return message ? { success: true, message, ...data } : { success: true, ...data }; }

function summarizeImages(images: GeneratedImage[]) {
  return images.map((img) => ({
    filename: img.filename,
    mimeType: img.mimeType,
    base64_preview: img.base64.substring(0, 80) + "...",
    size_kb: Math.round(img.base64.length * 0.75 / 1024),
  }));
}

export const tools = {

  // ─── A. Text-to-Image ──────────────────────────────────────────────

  content_design_generate: {
    description: "[Content Design] Genera imagenes con IA usando un prompt libre (Gemini Imagen 3). Solo texto, sin imagen de referencia.",
    inputSchema: {
      type: "object" as const,
      properties: {
        prompt: {
          type: "string",
          description: "Descripcion detallada de la imagen a generar",
        },
        aspect_ratio: {
          type: "string",
          enum: ["1:1", "16:9", "9:16", "4:3", "3:4"],
          description: "Relacion de aspecto (default: 1:1)",
        },
        number_of_images: {
          type: "number",
          description: "Variantes a generar (1-4, default: 1)",
        },
      },
      required: ["prompt"],
    },
    handler: async (args: any) => {
      try {
        const images = await generateImage(args.prompt, {
          aspectRatio: args.aspect_ratio,
          numberOfImages: Math.min(args.number_of_images || 1, 4),
        });
        return ok({
          images: summarizeImages(images),
          _generated: images,
          count: images.length,
        }, `${images.length} imagen(es) generada(s)`);
      } catch (e: any) {
        return err(`Gemini Imagen error: ${e.message}`);
      }
    },
  },

  content_design_generate_ad: {
    description: "[Content Design] Genera imagen publicitaria con parametros estructurados (nombre, estilo, mood, fondo). Prompt-only, sin referencia.",
    inputSchema: {
      type: "object" as const,
      properties: {
        product_name: { type: "string", description: "Nombre del producto" },
        description: { type: "string", description: "Descripcion breve del producto" },
        style: { type: "string", description: "Estilo: minimalist, luxury, vibrant, rustic, modern, editorial" },
        mood: { type: "string", description: "Atmosfera: elegant, warm, energetic, serene, bold" },
        background: { type: "string", description: "Fondo: white marble, tropical plants, gradient pastel, wooden table" },
        aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16", "4:3", "3:4"] },
        number_of_images: { type: "number", description: "Variantes (1-4)" },
        extra_instructions: { type: "string", description: "Instrucciones adicionales" },
      },
      required: ["product_name"],
    },
    handler: async (args: any) => {
      try {
        const images = await generateAdImage({
          productName: args.product_name,
          description: args.description,
          style: args.style,
          mood: args.mood,
          background: args.background,
          aspectRatio: args.aspect_ratio,
          numberOfImages: Math.min(args.number_of_images || 1, 4),
          extraInstructions: args.extra_instructions,
        });
        return ok({
          images: summarizeImages(images),
          _generated: images,
          count: images.length,
        }, `${images.length} imagen(es) publicitaria(s) generada(s)`);
      } catch (e: any) {
        return err(`Gemini Imagen error: ${e.message}`);
      }
    },
  },

  // ─── B. Reference-based Editing ────────────────────────────────────

  content_design_edit: {
    description: "[Content Design] Edita/transforma una imagen de referencia con un prompt. Usa Imagen 3 Capability para tomar el producto de la foto y colocarlo en un nuevo contexto, fondo o escena.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference_base64: {
          type: "string",
          description: "Imagen de referencia del producto en base64",
        },
        prompt: {
          type: "string",
          description: "Instruccion de edicion. Ej: 'Place this product on a marble countertop with soft morning light'",
        },
        subject_description: {
          type: "string",
          description: "Descripcion del sujeto/producto en la imagen de referencia",
        },
        mime_type: {
          type: "string",
          description: "MIME type de la imagen de referencia (default: image/webp). Ej: image/jpeg, image/png, image/webp",
        },
        number_of_images: {
          type: "number",
          description: "Variantes (1-4, default: 1)",
        },
      },
      required: ["reference_base64", "prompt"],
    },
    handler: async (args: any) => {
      try {
        const images = await editWithReference(args.reference_base64, args.prompt, {
          subjectDescription: args.subject_description,
          numberOfImages: Math.min(args.number_of_images || 1, 4),
          mimeType: args.mime_type,
        });
        return ok({
          images: summarizeImages(images),
          _generated: images,
          count: images.length,
        }, `${images.length} imagen(es) editada(s)`);
      } catch (e: any) {
        return err(`editImage error: ${e.message}`);
      }
    },
  },

  // ─── C. Product Photography Pipeline ───────────────────────────────

  content_design_product_shots: {
    description: "[Content Design] Genera fotos de producto en fondo blanco (frontal, lateral, posterior) a partir de una imagen de referencia. Usa editImage para mantener el producto real y cambiar angulo/fondo.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference_base64: {
          type: "string",
          description: "Imagen de referencia del producto en base64",
        },
        product_name: {
          type: "string",
          description: "Nombre del producto. Ej: 'Cepillo con vapor para mascotas'",
        },
        views: {
          type: "array",
          items: { type: "string", enum: ["front", "side", "back"] },
          description: "Vistas a generar (default: ['front', 'side', 'back'])",
        },
        mime_type: {
          type: "string",
          description: "MIME type de la imagen (default: image/webp)",
        },
      },
      required: ["reference_base64", "product_name"],
    },
    handler: async (args: any) => {
      const views = args.views || ["front", "side", "back"];
      const results: any[] = [];

      for (const view of views) {
        try {
          const images = await generateProductShot(args.reference_base64, args.product_name, view, args.mime_type);
          results.push({
            view,
            status: "ok",
            images: summarizeImages(images),
            _generated: images,
          });
        } catch (e: any) {
          results.push({ view, status: "error", error: e.message });
        }
      }

      const successCount = results.filter((r) => r.status === "ok").length;
      return ok(
        { shots: results, total: views.length, generated: successCount },
        `${successCount}/${views.length} vistas generadas para "${args.product_name}"`,
      );
    },
  },

  content_design_lifestyle: {
    description: "[Content Design] Genera foto lifestyle del producto en una escena real (mascota, hogar, uso). Toma la imagen de referencia y coloca el producto en un contexto aspiracional.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference_base64: {
          type: "string",
          description: "Imagen de referencia del producto en base64",
        },
        product_name: {
          type: "string",
          description: "Nombre del producto",
        },
        scene: {
          type: "string",
          description: "Escena deseada. Ej: 'persona cepillando a un golden retriever en un jardin soleado'. Si no se especifica, se genera una escena por defecto.",
        },
        mime_type: {
          type: "string",
          description: "MIME type de la imagen (default: image/webp)",
        },
      },
      required: ["reference_base64", "product_name"],
    },
    handler: async (args: any) => {
      try {
        const images = await generateLifestyleShot(
          args.reference_base64,
          args.product_name,
          args.scene,
          args.mime_type,
        );
        return ok({
          images: summarizeImages(images),
          _generated: images,
        }, `Lifestyle shot generado para "${args.product_name}"`);
      } catch (e: any) {
        return err(`Lifestyle error: ${e.message}`);
      }
    },
  },

  content_design_specs_shot: {
    description: "[Content Design] Genera foto tecnica/especificaciones del producto mostrando multiples angulos en estilo catalogo tecnico. Ideal para fichas de producto con detalles y dimensiones.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference_base64: {
          type: "string",
          description: "Imagen de referencia del producto en base64",
        },
        product_name: {
          type: "string",
          description: "Nombre del producto",
        },
        specs: {
          type: "string",
          description: "Especificaciones clave. Ej: '12cm x 6.5cm, silicona suave, recargable USB, deposito 20ml, mango giratorio 360'",
        },
        mime_type: {
          type: "string",
          description: "MIME type de la imagen (default: image/webp)",
        },
      },
      required: ["reference_base64", "product_name"],
    },
    handler: async (args: any) => {
      try {
        const images = await generateSpecsShot(
          args.reference_base64,
          args.product_name,
          args.specs,
          args.mime_type,
        );
        return ok({
          images: summarizeImages(images),
          _generated: images,
        }, `Specs shot generado para "${args.product_name}"`);
      } catch (e: any) {
        return err(`Specs error: ${e.message}`);
      }
    },
  },

  content_design_full_pipeline: {
    description: "[Content Design] Pipeline completo de fotografia de producto: genera 5 imagenes (frontal, lateral, posterior en fondo blanco + lifestyle + especificaciones tecnicas) a partir de UNA foto de referencia. Opcionalmente sube todas al producto ecommerce.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference_base64: {
          type: "string",
          description: "Imagen de referencia del producto en base64",
        },
        product_name: {
          type: "string",
          description: "Nombre del producto. Ej: 'Cepillo con vapor para mascotas'",
        },
        lifestyle_scene: {
          type: "string",
          description: "Escena para la foto lifestyle (opcional, se genera una por defecto)",
        },
        specs: {
          type: "string",
          description: "Especificaciones tecnicas del producto (opcional)",
        },
        product_id: {
          type: "string",
          description: "UUID del producto ecommerce para subir automaticamente (opcional — si se omite solo genera sin subir)",
        },
        replace: {
          type: "boolean",
          description: "true = reemplaza imagenes existentes del producto (default: false)",
        },
        mime_type: {
          type: "string",
          description: "MIME type de la imagen de referencia (default: image/webp)",
        },
      },
      required: ["reference_base64", "product_name"],
    },
    handler: async (args: any) => {
      try {
        // 1. Run full pipeline
        const pipelineResults = await runProductPipeline(
          args.reference_base64,
          args.product_name,
          args.lifestyle_scene,
          args.specs,
          args.mime_type,
        );

        const summary = pipelineResults.map((r) => ({
          view: r.view,
          status: r.error ? "error" : "ok",
          error: r.error || undefined,
          images: r.error ? [] : summarizeImages(r.images),
        }));

        const allImages = pipelineResults.flatMap((r) => r.images);
        const successCount = pipelineResults.filter((r) => !r.error).length;

        // 2. Upload if product_id provided
        let uploadResult: any = null;
        if (args.product_id && allImages.length > 0) {
          try {
            const uploadPayload = allImages.map((img) => ({
              base64: img.base64,
              filename: img.filename,
            }));

            const res = await api.post(
              `/ecommerce-products/${args.product_id}/images`,
              { images: uploadPayload, replace: args.replace ?? false },
            );

            if (res.ok) {
              uploadResult = {
                status: "ok",
                uploaded: allImages.length,
                product: res.data,
              };
            } else {
              uploadResult = {
                status: "error",
                error: `${res.status}: ${JSON.stringify(res.data)}`,
              };
            }
          } catch (e: any) {
            uploadResult = { status: "error", error: e.message };
          }
        }

        return ok({
          pipeline: summary,
          total_views: 5,
          generated: successCount,
          failed: 5 - successCount,
          total_images: allImages.length,
          upload: uploadResult,
        }, `Pipeline: ${successCount}/5 imagenes generadas` +
          (uploadResult ? `, upload: ${uploadResult.status}` : ""));
      } catch (e: any) {
        return err(`Pipeline error: ${e.message}`);
      }
    },
  },

  // ─── D. Upload ─────────────────────────────────────────────────────

  content_design_upload_to_product: {
    description: "[Content Design] Sube imagenes en base64 a un producto ecommerce via Cloudinary.",
    inputSchema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string", description: "UUID del producto ecommerce" },
        images: {
          type: "array",
          items: {
            type: "object",
            properties: {
              base64: { type: "string" },
              filename: { type: "string" },
            },
            required: ["base64", "filename"],
          },
          description: "Imagenes en base64",
        },
        replace: { type: "boolean", description: "Reemplazar existentes (default: false)" },
      },
      required: ["product_id", "images"],
    },
    handler: async (args: any) => {
      try {
        const res = await api.post(
          `/ecommerce-products/${args.product_id}/images`,
          { images: args.images, replace: args.replace ?? false },
        );
        if (!res.ok) return err(`Error ${res.status}: ${JSON.stringify(res.data)}`);
        return ok({ product: res.data }, `${args.images.length} imagen(es) subida(s)`);
      } catch (e: any) {
        return err(`Upload error: ${e.message}`);
      }
    },
  },

  content_design_generate_and_upload: {
    description: "[Content Design] Genera imagen publicitaria (prompt-only) y la sube a un producto ecommerce en un solo paso.",
    inputSchema: {
      type: "object" as const,
      properties: {
        product_id: { type: "string", description: "UUID del producto ecommerce" },
        product_name: { type: "string", description: "Nombre del producto" },
        description: { type: "string" },
        style: { type: "string" },
        mood: { type: "string" },
        background: { type: "string" },
        aspect_ratio: { type: "string", enum: ["1:1", "16:9", "9:16", "4:3", "3:4"] },
        number_of_images: { type: "number" },
        extra_instructions: { type: "string" },
        replace: { type: "boolean" },
      },
      required: ["product_id", "product_name"],
    },
    handler: async (args: any) => {
      try {
        const generated = await generateAdImage({
          productName: args.product_name,
          description: args.description,
          style: args.style,
          mood: args.mood,
          background: args.background,
          aspectRatio: args.aspect_ratio,
          numberOfImages: Math.min(args.number_of_images || 1, 4),
          extraInstructions: args.extra_instructions,
        });

        const res = await api.post(
          `/ecommerce-products/${args.product_id}/images`,
          {
            images: generated.map((img) => ({ base64: img.base64, filename: img.filename })),
            replace: args.replace ?? false,
          },
        );

        if (!res.ok) return err(`Generacion OK, upload fallo: ${res.status}`);

        return ok({
          product: res.data,
          generated_count: generated.length,
          filenames: generated.map((g) => g.filename),
        }, `${generated.length} imagen(es) generada(s) y subida(s)`);
      } catch (e: any) {
        return err(`Error: ${e.message}`);
      }
    },
  },
};
