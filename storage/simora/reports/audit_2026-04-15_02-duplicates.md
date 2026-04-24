# Phase 2 — Duplicate Detection

**Audit date:** 2026-04-15
**Method:** Group by `(name, size)` with `min_size ≥ 10 KB`. Heuristic — no content hash (no downloads).

---

## Summary

| Metric | Value |
|---|---:|
| Duplicate groups | 48 |
| Estimated wasted bytes | **~225 MB** |
| Groups with 2 copies | 48 (todas) |
| Groups with 3+ copies | 0 |

---

## 🔥 Hallazgo crítico — duplicación sistemática en Logística

**21 de los 48 grupos** (44 %) son archivos XLSX diarios de enero 2026 (`D-01-2026.xlsx`) presentes simultáneamente en dos rutas paralelas:

| Ruta | Propósito aparente |
|------|--------------------|
| `Área_Logística/1. Control Interno/0. Distribución/1. Local/[2026]/Enero` | Control interno |
| `Área_Logística/2. Control Servicio Logistico/1. Distribución Local - Domiflash/2026/Enero` | Reporte servicio Domiflash |

Ambas carpetas: 23 hijos, ~350 KB cada una, idénticos. **Patrón sistemático, no accidental** — probablemente duplicación manual mensual.

**Recomendación:** si ambos reportes deben existir, **symlink o fuente única** con vista scoped; si no, eliminar uno.

---

## Otros duplicados relevantes

### Marketing (mayor peso en bytes)

| Archivo | Tamaño | Rutas |
|---|---:|---|
| `VID_20250116_164948.mp4` | 132 MB | `MATERIAL CAJITA PODEROSA` + `Material testimonios video/Caso 1` |
| `lv_0_20251217053316.mp4` | 48 MB | raíz `Juliana cumpleaños` + raíz `Navidad` (crossover personal) |
| 10× `IMG_20250827_*.jpeg` | 24 MB total | `Material colores` + `MATERIAL CAJITA PODEROSA` |
| 3× `IMG_*.png` (testimonios) | 14 MB total | `Material testimonios fotos` + `MATERIAL CAJITA PODEROSA` |
| `grok_video_2026-03-02-19-40-09.mp4` | 1 MB | `Material IA` + `MATERIAL RECICLABLE` |

Patrón: carpetas "espejo" entre campañas (`MATERIAL CAJITA PODEROSA` vs `Material testimonios`). Revisar si son intencionales.

### Contabilidad

- **`11 ABRIL CUENTA DE COBRO Troquel Graf Tg.pdf`** (212 KB) — en `Gestión Compras/04. Abril/...` y `06. Junio/...` → **posible factura mal archivada cruzando meses**
- **`4 ABRIL CAMARA DE COMERCIO DE BOGOTA.zip`** (50 KB) — mismo patrón Abril ↔ Junio

### Recursos Humanos

- **`1. Incapacidad 9 al 10 Abril Paula Valentina Ariza Polania.pdf`** copiado en carpetas de **dos empleados distintos** (Paula Valentina ↔ Lina María Beltrán) → **error de filing importante**, revisar a cuál pertenece
- **`6. 16 al 31 Octubre_Comprobante bancario.jpg`** copiado entre nóminas de **Andrés Polania ↔ Laura Rincón**

### Logística — fotos de registro fotográfico (subcarpetas anidadas)

Ruta canónica: `...[2025]/5. Mayo/Registro Fotografico/`
- `22-052025,23-05-2025/` (correcto)
- `24-05-2025,26-05-2025/22-052025,23-05-2025/` (**carpeta anidada accidental**)

Archivos duplicados: `sonia Raquel Mosquera Ortiz.jpg`, `Nini Johana Soto Neira.jpg`, `Ana Rojas Ladino.jpg` → mismo JPG en ambas rutas. La carpeta anidada es claramente un error.

---

## Recomendaciones por prioridad

### 🔴 Alta — acción inmediata
1. **Revisar duplicación Control Interno vs Control Servicio Logistico** (21 archivos, patrón sistemático). Define responsable y fuente única.
2. **Archivo de incapacidad cruzado entre empleados** — verificar a qué empleado corresponde realmente y borrar la copia incorrecta.
3. **Fotos de empleados (Ana/Nini/Sonia)** en carpeta anidada errónea — mover o borrar la anidación.

### 🟡 Media
4. **Factura Cámara de Comercio / Troquel Graf** duplicada entre Abril y Junio — decidir mes correcto.
5. **Comprobante bancario** cruzado entre dos nóminas de empleados — revisar.

### 🟢 Baja — probablemente intencional
6. Duplicados en `Material colores` / `MATERIAL CAJITA PODEROSA` / `Material testimonios` → revisar con Marketing si son copias estratégicas por campaña.
7. Cruce `Juliana cumpleaños` / `Navidad` — personal, baja prioridad.

---

## Limitaciones del método

- Detección por `(nombre, tamaño)`: **falsos negativos** posibles si el contenido es igual pero cambió el nombre.
- **Falsos positivos** posibles si dos archivos distintos coinciden casualmente en nombre y tamaño (raro con archivos ofimáticos).
- Para confirmación exacta: enriquecer graph con `quickXorHash` del API Graph (ya viene en la respuesta, pendiente de implementar en `tenant_ms_onedrive_snapshot`).

---

## Próximas fases

- **Fase 3** — per-area deep audit con gap detection mensual.
- **Fase 5** — consolidar estos duplicados con reglas de limpieza (keep-newest, misplaced).