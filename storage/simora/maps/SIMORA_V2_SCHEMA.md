# simora_v2 — Mapa del Schema Analítico

> Schema PostgreSQL para auditoría, análisis financiero y ML.
> Alimentado desde múltiples fuentes: MongoDB legacy, Novalogic ERP, OneDrive.
> **Solo lectura desde producción — escritura exclusivamente vía ETL scripts / Internal API.**

---

## Ubicación

```
PostgreSQL (mismo servidor que Novalogic)
  schema: simora_v2
  usuario ETL: usa NOVALOGIC_API_KEY via Internal API /internal/analytics/*
```

---

## Tablas

### Dimensiones

| Tabla | Filas | Fuentes | Descripción |
|---|---|---|---|
| `dim_customers` | 19,133 | legacy_mongo | Maestro de clientes unificado |
| `dim_products` | 154 | legacy_mongo | Catálogo de productos Magibell |
| `dim_sellers` | 8 | legacy_mongo | Vendedores / asesores |

### Hechos (Facts)

| Tabla | Filas | Fuentes | Descripción |
|---|---|---|---|
| `fact_orders` | 22,360 | legacy_mongo | Pedidos con financieros completos. Revenue: $796M COP |
| `fact_order_items` | 25,734 | legacy_mongo | Líneas de pedido (producto × cantidad) |
| `fact_guides` | 22,360 | legacy_mongo | Guías de despacho, 1:1 con fact_orders |
| `fact_courier_reports` | 37,540 | onedrive | Reportes Domiflash XLSX (37 archivos, 2023–2026) |
| `fact_bank_transactions` | 198 | onedrive | Extractos Bancolombia cta 52500011739 (6 meses 2025) |

### Control

| Tabla | Descripción |
|---|---|
| `etl_runs` | Audit trail de cada carga ETL con conteos y estado |

---

## Campos clave por tabla

### `dim_customers`
| Campo | Tipo | Notas |
|---|---|---|
| `id` | UUID PK | Generado por DB |
| `source` | ENUM | `legacy_mongo`, `novalogic`, `onedrive`, `manual` |
| `source_id` | VARCHAR | ID original de la fuente (_id de Mongo, UUID de Novalogic) |
| `full_name` | VARCHAR | Nombre completo |
| `email`, `phone` | VARCHAR | Contacto |
| `city`, `department` | VARCHAR | Geografía Colombia |
| `raw` | JSONB | Documento original completo |

### `fact_orders`
| Campo | Tipo | Notas |
|---|---|---|
| `source_id` | VARCHAR | `_id` de Mongo o `saleNumber` de Novalogic |
| `tracking_code` | VARCHAR | MAGxxxxx |
| `customer_id` | UUID FK | → dim_customers |
| `seller_id` | UUID FK | → dim_sellers |
| `order_date` | TIMESTAMPTZ | Fecha creación |
| `subtotal`, `iva`, `shipping_cost`, `total` | NUMERIC(14,2) | Financieros |
| `payment_type` | VARCHAR | Normalizado (Contraentrega / Anticipado / etc.) |
| `guide_number` | VARCHAR | Número de guía del operador logístico |
| `city`, `department` | VARCHAR | Destino del pedido |

---

## Fuentes de datos

### 1. MongoDB Legacy (`legacy_mongo`)
- **Container**: `magibell-mongodb` → puerto 27019
- **DB**: `magibell_legacy`
- **Período**: Mayo 2024 – Noviembre 2025
- **Script ETL**: `scripts/etl/01_legacy_mongo_to_simora_v2.py`
- **Colecciones mapeadas**:
  - `sellers` → `dim_sellers`
  - `customers` → `dim_customers`
  - `products` → `dim_products`
  - `orders` → `fact_orders` + `fact_order_items`
  - `guides` + `orders.envio` → `fact_guides` ✅

### 2. Novalogic ERP (`novalogic`)
- **DB**: PostgreSQL schemas: `public`, `logistics`, `security`
- **Período**: 2024 – presente
- **Script ETL**: `scripts/etl/02_novalogic_to_simora_v2.py` *(pendiente)*
- **Tablas mapeadas**:
  - `sales.sales` → `fact_orders`
  - `sales.sale_items` → `fact_order_items`
  - `logistics.shipments` → `fact_guides`
  - `customers.customers` → `dim_customers`
  - `products.products` → `dim_products`

### 3. OneDrive Contabilidad (`onedrive`)
- **Ruta**: `CONTROL INTERNO/control-interno.v2/Contabilidad/`
- **Script ETL**: `scripts/etl/03_onedrive_accounting_to_simora_v2.py` *(pendiente)*
- **Archivos mapeados**:
  - `03_Gestion-de-Compras/` → tabla `fact_purchases` *(pendiente)*
  - `01_Documentos-Fiscales-Tributarios/` → tabla `fact_tax_documents` *(pendiente)*
  - `07_Registro-de-Transferencias/` → cruce con `fact_orders`

---

## Herramientas MCP disponibles

```
analytics_summary          — Resumen financiero completo
analytics_table_counts     — Conteo de filas por tabla
analytics_etl_start        — Iniciar un ETL run
analytics_etl_finish       — Cerrar un ETL run con conteos
analytics_etl_list         — Ver historial de ETL runs
analytics_upsert_*         — Insertar/actualizar entidades
```

## Scripts Python disponibles

```
scripts/
  requirements.txt
  etl/
    01_legacy_mongo_to_simora_v2.py   ← MongoDB legacy → simora_v2
    02_novalogic_to_simora_v2.py      ← pendiente
    03_onedrive_accounting.py          ← pendiente
  analysis/
    (vacío — aquí van scripts de auditoría y ML)
```

---

## Diagrama ER → ver `SIMORA_V2_DBDIAGRAM.md`
