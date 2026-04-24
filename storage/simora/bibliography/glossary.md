# Glossary — Simora

## Entidades de negocio

| Término | Definición |
|---|---|
| **Simora SAS BIC** | Razón social. CompanyId Novalogic: `2af87e54-33a6-4a60-9b88-63582d3edacb`. |
| **Magibell** | Marca comercial de Simora (esmaltes, base, productos para uñas). |
| **Domiflash** | Empresa de mensajería local (Bogotá/Soacha) que opera distribución última milla. Proveedor externo; **no es tenant Novalogic todavía** — carrier workspace sin release. |
| **MAG#### / MAG######** | Código interno de factura/tracking de Simora (ej. `MAG16589`). Aparece en la columna `Factura` de los reportes courier. |
| **Cuenta 52500011739** | Cuenta bancaria principal de Simora (banco por confirmar — prefijo sugiere Banco de Occidente). |

## Dominios OneDrive

| Carpeta | Contenido |
|---|---|
| `CONTROL INTERNO/Área_Contabilidad/` | Finanzas, extractos, compras, nómina, transferencias |
| `CONTROL INTERNO/Área_Logística Simora/` | Operación logística, planillas, reportes courier |
| `CONTROL INTERNO/Área_Marketing/` | Videos e imágenes de campañas (93% del storage OneDrive) |
| `CONTROL INTERNO/Área_Ventas Simora/` | Estrategia + reportes consolidados (ventas reales en Novalogic DB) |
| `CONTROL INTERNO/Área_Recursos Humanos Simora/` | Gestión colaboradores, nómina, SG-SST |
| `CONTROL INTERNO/Área_Producción Simora/` | Producción Magibell / Magistral |
| `CONTROL INTERNO/Área_Diseño Simora/` | Assets vectoriales, ilustraciones, PDFs de producto |

## Convenciones de nombres de archivo

| Patrón | Significado | Ejemplo |
|---|---|---|
| `YYYY-MM.xlsx` (courier) | Reporte mensual Domiflash | `2025-04.xlsx` |
| `52500011739_MMMYYYY_0.xlsx` | Extracto bancario mensual | `52500011739_ENE2025_0.xlsx` |
| `N. MESYYYY.pdf` | Extracto bancario trimestral 2023 | `1. MARZO2023.pdf` |
| `MES1-MES2.pdf` | Extracto bancario bimestral 2024 | `MARZO-ABRIL.pdf` |
| `D-MM-YYYY.xlsx` | Planilla diaria logística | `15-01-2026.xlsx` |

## Columnas estándar reportes courier

- `Fecha` — fecha de entrega/intento
- `Factura` — tracking Simora (MAG####)
- `Valor` — valor del pedido
- `Flete` — costo de envío cobrado por courier
- `Destino` — ciudad (`Bogotá`, `Soacha`, etc.)
- `Visita` — número de intento (`1ra`, `2da`, `3ra`)
- `Novedad` / `Estado` — status (`ENTREGADO`, devuelto, etc.)
- `Cobro` — monto recaudado (COD / contraentrega)
- `Cliente` — nombre destinatario
- `Descripción` — notas libres

## Reglas de envío

- Envío **gratis** en Bogotá y Soacha.
- **Excepciones** (no aplica envío gratis):
  - Pedidos de $16.500 (base sola)
  - Pedidos de $25.000 (base + esmalte)

Ver `rules/shipping-rules.json` para fuente canónica.
