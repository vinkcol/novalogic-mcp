# simora_v2 — Diagrama de Base de Datos

> Copiar el bloque de código en **https://dbdiagram.io** para visualizar el diagrama interactivo.

```dbml
// simora_v2 — Analytical Data Warehouse
// Proyecto: Novalogic / Simora / Magibell
// Actualizado: 2026-04-17

Project simora_v2 {
  database_type: 'PostgreSQL'
  Note: '''
    Schema analítico multi-fuente para auditoría y ML.
    Fuentes: MongoDB legacy, Novalogic ERP, OneDrive.
    Escritura exclusiva vía Internal API /internal/analytics/*.
  '''
}

// ─── ENUM ─────────────────────────────────────────────────────

Enum data_source {
  legacy_mongo
  novalogic
  onedrive
  manual
}

// ─── DIMENSIONS ───────────────────────────────────────────────

Table dim_customers {
  id              uuid      [pk, default: `gen_random_uuid()`]
  source          data_source [not null]
  source_id       varchar(100) [not null, note: "_id Mongo o UUID Novalogic"]
  full_name       varchar(255)
  first_name      varchar(100)
  last_name       varchar(100)
  email           varchar(255)
  phone           varchar(50)
  document_type   varchar(20)
  document_number varchar(50)
  city            varchar(100)
  department      varchar(100)
  address         text
  raw             jsonb        [note: "Documento original completo"]
  created_at      timestamptz
  imported_at     timestamptz  [default: `now()`]

  indexes {
    (source, source_id) [unique, name: "uq_customers_source"]
    (city, department)  [name: "idx_sv2_customers_city"]
  }
}

Table dim_products {
  id          uuid      [pk, default: `gen_random_uuid()`]
  source      data_source [not null]
  source_id   varchar(100) [not null]
  sku         varchar(100)
  name        varchar(255)
  category    varchar(100)
  brand       varchar(100) [default: "Magibell"]
  unit_price  decimal(14,2)
  cost_price  decimal(14,2)
  is_active   boolean [default: true]
  raw         jsonb
  created_at  timestamptz
  imported_at timestamptz [default: `now()`]

  indexes {
    (source, source_id) [unique, name: "uq_products_source"]
  }
}

Table dim_sellers {
  id          uuid      [pk, default: `gen_random_uuid()`]
  source      data_source [not null]
  source_id   varchar(100) [not null]
  full_name   varchar(255)
  email       varchar(255)
  phone       varchar(50)
  role        varchar(50)
  branch      varchar(100)
  is_active   boolean [default: true]
  raw         jsonb
  created_at  timestamptz
  imported_at timestamptz [default: `now()`]

  indexes {
    (source, source_id) [unique, name: "uq_sellers_source"]
  }
}

// ─── FACTS ────────────────────────────────────────────────────

Table fact_orders {
  id                uuid      [pk, default: `gen_random_uuid()`]
  source            data_source [not null]
  source_id         varchar(100) [not null, note: "_id Mongo / saleNumber Novalogic"]
  tracking_code     varchar(50)  [note: "MAGxxxxx"]
  customer_id       uuid         [ref: > dim_customers.id]
  seller_id         uuid         [ref: > dim_sellers.id]
  order_date        timestamptz
  delivery_date     date
  subtotal          decimal(14,2)
  iva               decimal(14,2)
  shipping_cost     decimal(14,2)
  discount          decimal(14,2) [default: 0]
  total             decimal(14,2)
  payment_type      varchar(80)  [note: "Normalizado: Contraentrega/Anticipado/etc."]
  payment_status    varchar(50)
  has_payment_proof boolean [default: false]
  guide_number      varchar(100)
  city              varchar(100)
  department        varchar(100)
  carrier           varchar(100)
  delivery_status   varchar(50)
  item_count        integer
  raw               jsonb
  imported_at       timestamptz [default: `now()`]

  indexes {
    (source, source_id)   [unique, name: "uq_orders_source"]
    order_date            [name: "idx_sv2_orders_date"]
    customer_id           [name: "idx_sv2_orders_customer"]
    seller_id             [name: "idx_sv2_orders_seller"]
    total                 [name: "idx_sv2_orders_total"]
    tracking_code         [name: "idx_sv2_orders_tracking"]
    source                [name: "idx_sv2_orders_source"]
  }
}

Table fact_order_items {
  id                uuid [pk, default: `gen_random_uuid()`]
  order_id          uuid [not null, ref: > fact_orders.id]
  product_id        uuid [ref: > dim_products.id]
  source_product_id varchar(100)
  product_name      varchar(255)
  quantity          integer
  unit_price        decimal(14,2)
  total             decimal(14,2)
  imported_at       timestamptz [default: `now()`]

  indexes {
    order_id   [name: "idx_sv2_items_order"]
    product_id [name: "idx_sv2_items_product"]
  }
}

Table fact_guides {
  id                     uuid [pk, default: `gen_random_uuid()`]
  source                 data_source [not null]
  source_id              varchar(100) [not null]
  guide_number           varchar(100)
  order_id               uuid [ref: > fact_orders.id]
  customer_id            uuid [ref: > dim_customers.id]
  carrier                varchar(100)
  destination_city       varchar(100)
  destination_department varchar(100)
  ship_date              date
  delivery_date          date
  status                 varchar(50)
  declared_value         decimal(14,2)
  shipping_cost          decimal(14,2)
  raw                    jsonb
  imported_at            timestamptz [default: `now()`]

  indexes {
    (source, source_id) [unique, name: "uq_guides_source"]
    order_id            [name: "idx_sv2_guides_order"]
    guide_number        [name: "idx_sv2_guides_number"]
  }
}

// ─── ETL AUDIT ────────────────────────────────────────────────

Table etl_runs {
  id                 uuid [pk, default: `gen_random_uuid()`]
  company_slug       varchar(50) [not null, note: "e.g. simora"]
  source             data_source [not null]
  entity             varchar(100) [not null, note: "orders / customers / all"]
  started_at         timestamptz [default: `now()`]
  finished_at        timestamptz
  records_processed  integer [default: 0]
  records_inserted   integer [default: 0]
  records_updated    integer [default: 0]
  records_failed     integer [default: 0]
  status             varchar(20) [default: "running", note: "running/completed/failed"]
  error_log          text
  metadata           jsonb

  indexes {
    (company_slug, source, entity) [name: "idx_sv2_etl_company"]
  }
}
```

---

## Notas de diseño

| Decisión | Razón |
|---|---|
| `raw JSONB` en cada tabla | Preserva el documento original sin pérdida — crítico para auditoría |
| `(source, source_id)` UNIQUE | Permite upserts idempotentes desde múltiples fuentes |
| `payment_type` normalizado | El legacy tiene 15+ variantes de "Contraentrega" |
| `etl_runs` separado | Trazabilidad completa de cuándo y cuánto se cargó |
| No hay FK a Novalogic `public.*` | simora_v2 es schema aislado — no depende del esquema operacional |
