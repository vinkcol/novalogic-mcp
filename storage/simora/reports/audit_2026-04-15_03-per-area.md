# Phase 3 — Per-Area Deep Audit

**Audit date:** 2026-04-15
**Áreas auditadas:** Contabilidad · Logística · Marketing · RRHH · Ventas · Producción · Diseño

---

## 💰 Área_Contabilidad

| Metric | Value |
|---|---:|
| Archivos | 1,071 |
| Carpetas | 228 |
| Tamaño | **782 MB** |

### Distribución
| Categoría | Archivos | Tamaño |
|---|---:|---:|
| spreadsheet | 24 | **637 MB** ⚠️ |
| image | 744 | 74 MB |
| archive | 115 | 43 MB |
| pdf | 186 | 26 MB |
| presentation | 2 | 114 KB |

**Subcarpetas:**
| Subcarpeta | Archivos | Tamaño |
|---|---:|---:|
| Registro de Transferencias | **2** | **568 MB** 🔴 |
| Contabilidad | 707 | 157 MB |
| Gestión de Compras | 310 | 45 MB |
| Documentos Fiscales y Tributarios | 19 | 4 MB |
| Seguridad social | 16 | 3.8 MB |
| Extractos Simora | 15 | 2.8 MB |
| Pagos oficina | 1 | 23 KB |
| Ctas. de Nómina | 1 | 9 KB |

### 🚨 Hallazgos críticos

**1. Registro de Transferencias = 568 MB en solo 2 archivos.** XLSX gigantes; riesgo de corrupción, dificultad de versionado, imposibilidad de edición concurrente. **Recomendación:** fragmentar por año o migrar a base de datos estructurada.

**2. Gaps críticos en Extractos Bancarios:**

| Año | Archivos presentes | Meses faltantes |
|---|---:|---|
| **2023** | 4 | ene, feb, abr, may, jul, ago, oct, nov (solo fin de trimestre: mar/jun/sep/dic) |
| **2024** | 4 | ene, feb, may, jun, jul, ago, sep (hay: mar, abr, oct, nov, dic) |
| **2025** | 7 | **ago, sep, oct, nov, dic** (hay ENE-JUL con nomenclatura `52500011739_XXX2025_0.xlsx`) |

⚠️ **2025 es el año operativo actual y faltan 5 meses consecutivos** (ago-dic 2025). Si ya se emitieron, están fuera de OneDrive.

**3. `Pagos oficina` y `Ctas. de Nómina` con 1 archivo cada una** — carpetas infrautilizadas o contenido disperso.

---

## 🚚 Área_Logística Simora

| Metric | Value |
|---|---:|
| Archivos | 2,585 |
| Carpetas | 341 |
| Tamaño | **579 MB** |

### Distribución
| Categoría | Archivos | Tamaño |
|---|---:|---:|
| spreadsheet | 1,848 | 334 MB |
| image | 715 | 216 MB |
| document | 7 | 1.8 MB |
| other | 14 | 1.4 MB |
| pdf | 1 | 16 KB |

### Por año
| Año | Files | Tamaño |
|---|---:|---:|
| 2026 | 202 | 5.6 MB |
| 2025 | 1,189 | 265 MB |
| 2024 | 1,191 | 308 MB |
| 2023 | 3 | 206 KB |

### Subcarpetas raíz
| Subcarpeta | Archivos | Tamaño |
|---|---:|---:|
| 1. Control Interno | 1,743 | 532 MB |
| 2. Control Servicio Logistico | 817 | 15 MB |
| 3. Otros | 8 | 3.9 MB |
| 0. Formatos | 17 | 1.5 MB |

### 🚨 Hallazgos

**1. Duplicación sistemática (identificada en Phase 2):** 21 XLSX de enero 2026 duplicados entre `1. Control Interno/.../Enero` y `2. Control Servicio Logistico/Domiflash/2026/Enero`. Carpetas espejo.

**2. Registro Planillas Diarias** organizado por **tipo** (Formatos Mensajeria, Recaudo Contraentrega, Recolección Mercancía), no por mes — diferente convención que extractos. Gap monthly no aplica a este nivel.

**3. Reportes Local Domiflash** bien estructurado por año:
- 2023: 9 files, 2024: 12 files, 2025: 12 files, 2026: 4 files
- Serie consistente en 2024/2025 (probable 1 file/mes). **Confirmar que abril-dic 2026 no falten** conforme avance el año.

**4. Densidad anómala:** 2024 tiene 1,191 files / 308 MB, 2025 tiene 1,189 files / 265 MB — pero 2026 solo 202 files / 5.6 MB (primer trimestre). **Confirmar si el volumen 2026 va acorde al avance del año.**

---

## 🎨 Área_Marketing

| Metric | Value |
|---|---:|
| Archivos | 382 |
| Carpetas | 19 |
| Tamaño | **25.80 GB** |

### Distribución
| Categoría | Archivos | Tamaño |
|---|---:|---:|
| **video** | **214** | **25.48 GB** |
| image | 168 | 322 MB |

**Todo es 2026.** Campañas recientes.

### Subcarpetas
| Subcarpeta | Archivos | Tamaño |
|---|---:|---:|
| MATERIAL RECICLABLE | 87 | **12.03 GB** |
| Material testimonios video | 71 | 6.04 GB |
| Material envíos | 60 | 5.87 GB |
| Cosmetiquera | 15 | 1.04 GB |
| Material apoyo | 5 | 343 MB |
| Contenido 📸 | 5 | 294 MB |
| Material testimonios fotos | 24 | 74 MB |
| Material colores | 14 | 37 MB |
| Material Productos fotos | 15 | 31 MB |
| Material IA | 25 | 20 MB |
| Material testimonios texto | 38 | 10 MB |
| Material uñas feas foto | 23 | 3 MB |

### 🚨 Hallazgos

**1. 93% de todo el OneDrive de Simora son videos de Marketing 2026.** Gran oportunidad de **archivo frío** (Azure Blob Cool / SharePoint archive) para los videos ya publicados.

**2. Duplicación cruzada entre subcarpetas** (ya cubierto en Phase 2): `MATERIAL CAJITA PODEROSA` vs `Material testimonios fotos/Caso 1` vs `Material colores`.

**3. Nomenclatura inconsistente**: `MATERIAL RECICLABLE` (mayúsculas) vs `Material testimonios video` (capitalizado) vs `Contenido 📸` (emoji).

---

## 👥 Área_Recursos Humanos Simora

| Metric | Value |
|---|---:|
| Archivos | 591 |
| Carpetas | 171 |
| Tamaño | **133 MB** |

### Distribución
| Categoría | Archivos | Tamaño |
|---|---:|---:|
| pdf | 397 | 77 MB |
| image | 184 | 37 MB |
| spreadsheet | 4 | 12 MB |
| archive | 1 | 5 MB |
| document | 5 | 158 KB |

### Subcarpetas
| Subcarpeta | Archivos | Tamaño |
|---|---:|---:|
| Gestión Colaboradores | 563 | 122 MB |
| SG-SST Simora | 28 | 10 MB |

### 🚨 Hallazgos

**1. Error de filing (identificado en Phase 2):** archivo de incapacidad de Paula Valentina Ariza copiado en carpeta de Lina María Beltrán. Requiere revisión manual de asignación.

**2. Comprobante bancario** duplicado entre nóminas de Andrés Polania y Laura Rincón.

**3. Ratio folders/files muy alto**: 171 carpetas / 591 files = 3.5 archivos por carpeta. Estructura muy granular (por empleado + por año + por tipo).

---

## 💼 Área_Ventas Simora

| Metric | Value |
|---|---:|
| Archivos | 21 |
| Carpetas | 12 |
| Tamaño | **82 MB** |

### Distribución
| Categoría | Archivos | Tamaño |
|---|---:|---:|
| pdf | 1 | 81 MB ⚠️ |
| spreadsheet | 19 | 668 KB |
| document | 1 | 16 KB |

### 🚨 Hallazgos

**1. Un PDF (ALIADA MAGIBELL) concentra 99% del área (81 MB de 82 MB).** Revisar si es necesario o si es documento legado pesado.

**2. Ventas reales viven en Novalogic DB**, no aquí — OneDrive tiene solo reportes consolidados y estrategia. Esto es correcto arquitectónicamente.

**3. Archivos sueltos en raíz del área** (fuera de subcarpetas temáticas):
- `KITS.xlsx`, `Top mas vendidos 2024.xlsx`, `ESTRATEGIA NACIONALES 2026.docx`, `LISTA PRODUCTOS MAGIBELL.xlsx`

Recomendación: crear subcarpeta `Planeación y Estrategia/` para agrupar.

---

## 🏭 Área_Producción Simora

| Metric | Value |
|---|---:|
| Archivos | 28 |
| Carpetas | 31 |
| Tamaño | **23 MB** |

⚠️ **Más carpetas (31) que archivos (28)** — estructura sobre-dimensionada.

### Subcarpetas
| Subcarpeta | Archivos | Tamaño |
|---|---:|---:|
| Producción Magibell | 8 | 16 MB |
| Producción Magistral | 20 | 6.8 MB |

### Hallazgo: muchas carpetas vacías o con 1 archivo.

---

## 🎨 Área_Diseño Simora

| Metric | Value |
|---|---:|
| Archivos | 62 |
| Carpetas | 18 |
| Tamaño | **145 MB** |

### Distribución
| Categoría | Archivos | Tamaño |
|---|---:|---:|
| other (`.ai`, `.svg`, `.lnk`) | 17 | 71 MB |
| pdf | 22 | 70 MB |
| image | 16 | 3 MB |
| spreadsheet | 6 | 275 KB |
| document | 1 | 14 KB |

### 🚨 Hallazgos

**1. Extensiones sospechosas en raíz:**
- `Humectante1.xlsx.jpg` — doble extensión
- `Endurecedor1.xlsx.jpg` — doble extensión
- `Escritorio - Acceso directo.lnk` — **shortcut de Windows huérfano** (no sirve en SharePoint)

**2. ~18 archivos sueltos en raíz del área** (`.ai`, `.svg`, `.pdf`, `.xlsx`) sin organización. Convendría subcarpetas por tipo (`Ilustraciones vectoriales`, `Órdenes de Trabajo`, `Cálculos de costos`).

**3. Duplicado (Phase 2):** `Mesa de trabajo 1.pdf` en `Productos/PDF/` y `Ilustraciones/1x/PDF/`.

---

## Resumen transversal

| Prioridad | Hallazgo | Área |
|:-:|---|---|
| 🔴 | Extractos 2025 sin ago-dic | Contabilidad |
| 🔴 | Registro Transferencias = 568 MB en 2 archivos | Contabilidad |
| 🔴 | Incapacidad archivada en empleado incorrecto | RRHH |
| 🔴 | Duplicación sistemática Control Interno ↔ Servicio Logistico | Logística |
| 🟡 | Extractos 2023/2024 con grandes gaps | Contabilidad |
| 🟡 | 25 GB de videos Marketing 2026 en almacenamiento caliente | Marketing |
| 🟡 | Factura Abril duplicada en Junio | Contabilidad |
| 🟢 | Archivos sueltos en raíz de Ventas y Diseño | Ventas, Diseño |
| 🟢 | Carpetas vacías Producción | Producción |
| 🟢 | Nomenclatura inconsistente Marketing | Marketing |

---

## Próximas fases

- **Fase 4** — Extracción: descargar y parsear los 7 extractos 2025 existentes (ENE-JUL) + Reportes Domiflash para cruces.
- **Fase 5** — Consolidar cleanup recomendaciones accionables.