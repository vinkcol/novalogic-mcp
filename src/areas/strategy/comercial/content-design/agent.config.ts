import type { AgentDefinition } from "../../../../shared/types.js";

export const agentConfig: AgentDefinition = {
  id: "content-design",
  name: "Content Design",
  description:
    "Generacion de imagenes publicitarias con IA (Gemini Imagen 3). " +
    "Text-to-image, edicion con referencia, pipeline de fotografia de producto " +
    "(frontal/lateral/posterior + lifestyle + specs) y upload a ecommerce via Cloudinary.",
  role: "specialist",
  areaId: "comercial",
  reportsTo: "sales",
  capabilities: [
    "text-to-image",
    "reference-based-editing",
    "product-photography-pipeline",
    "lifestyle-shots",
    "specs-shots",
    "upload-to-ecommerce",
  ],
  toolPrefix: "content_design_",
};
