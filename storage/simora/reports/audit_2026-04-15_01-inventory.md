# Phase 1 — Inventory & Classification

**Audit date:** 2026-04-15
**Snapshot graph:** `simora-onedrive`
**Scope:** Full OneDrive of `info@simora.co` (Simora SAS BIC)

---

## Totales globales

| Metric | Value |
|---|---:|
| Total nodes | 5,753 |
| Folders | 839 |
| Files | 4,914 |
| Total size | **28.00 GB** (29,476,246,822 bytes) |

---

## Distribución por categoría

| Categoría | Archivos | Tamaño | % del total |
|---|---:|---:|---:|
| 🎬 video | 234 | 25.43 GB | **92.6 %** |
| 📊 spreadsheet | 1,940 | 0.95 GB | 3.5 % |
| 🖼 image | 1,879 | 706 MB | 2.5 % |
| 📄 pdf | 663 | 273 MB | 1.0 % |
| 📦 archive | 116 | 47 MB | 0.2 % |
| 🔤 other | 46 | 70 MB | 0.2 % |
| 📝 document | 30 | 3.4 MB | <0.1 % |
| 📑 presentation | 2 | 112 KB | — |
| 🧩 collaboration | 4 | 93 KB | — |

**Hallazgo clave:** 234 archivos de video concentran el **93 %** de todo el almacenamiento.

---

## Distribución por año (last_modified)

| Año | Archivos | Tamaño | Nota |
|---|---:|---:|---|
| 2026 | 664 | 24.21 GB | Año en curso — videos pesados de Marketing |
| 2025 | 1,878 | 2.61 GB | Año operativo normal |
| 2024 | 2,369 | 645 MB | Año con más archivos |
| 2023 | 3 | 206 KB | Data residual |

---

## Top-level (raíz OneDrive)

| Folder | Archivos | Tamaño | Tipo |
|---|---:|---:|---|
| **CONTROL INTERNO** | 4,767 | **25.68 GB** | núcleo negocio |
| Juliana cumpleaños | 25 | 1.16 GB | personal |
| Navidad | 8 | 332 MB | personal |
| Attachments | 1 | 126 MB | adjuntos chat |
| Recordings | 1 | 108 MB | grabaciones |
| Microsoft Teams Chat Files | 28 | 42 MB | chat |
| Archivos de chat de Microsoft Teams | 60 | 15 MB | chat |
| Pagos general | 1 | 3.3 MB | ⚠️ fuera de CONTROL INTERNO |
| Plantillas Documentos | 11 | 801 KB | plantillas |

~97 % de los bytes operativos viven en `CONTROL INTERNO`.

---

## CONTROL INTERNO — desglose por área

| Área | Archivos | Tamaño | % |
|---|---:|---:|---:|
| 🎨 **Área_Marketing** | 382 | **24.04 GB** | 87.2 % |
| 💰 Área_Contabilidad | 1,071 | 746 MB | 2.7 % |
| 🚚 **Área_Logística Simora** | 2,585 | 553 MB | 2.0 % |
| 🎨 Área_Diseño Simora | 62 | 138 MB | 0.5 % |
| 👥 Área_RRHH Simora | 591 | 127 MB | 0.5 % |
| 💼 Área_Ventas Simora | 21 | 78 MB | 0.3 % |
| 📋 Documentos Simora | 25 | 24 MB | 0.1 % |
| 🏭 Área_Producción Simora | 28 | 22 MB | 0.1 % |
| CONTABILIDAD ESTADO DE CUENTA 2025 | 1 | 12 KB | — |

---

## Observaciones preliminares

1. **Marketing domina en bytes** (24 GB) pero no en cantidad (382 archivos). Oportunidad de ahorro archivando videos antiguos.
2. **Logística tiene mayor densidad operativa** — 2,585 archivos / 553 MB. Archivos chicos (planillas diarias, reportes courier).
3. **Contabilidad es mediana** — 1,071 archivos / 746 MB. Muchas fotos de recibos/facturas probablemente.
4. **Área_Ventas** está light (21 archivos) — las ventas reales viven en Novalogic DB; OneDrive tiene solo reportes consolidados.
5. **Pagos general** en raíz — inconsistente; candidato a mover a `Área_Contabilidad/Pagos oficina`.
6. **2026 pesa 24 GB** por videos Marketing — confirmar si pueden pasar a archivo frío (SharePoint archive / Azure Blob cool).

---

## Próximas fases

- **Fase 2** — Duplicados por (nombre, tamaño)
- **Fase 3** — Reportes profundos por área + gaps en series mensuales
- **Fase 4** — Extracción estructurada de XLSX contabilidad/logística
- **Fase 5** — Lista accionable de limpieza