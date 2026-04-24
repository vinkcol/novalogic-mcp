-- ============================================================
-- simora_v2 — Schema analítico completo
-- Target: novalogic_mcp (novalogic-mcp-db, puerto 5433)
-- Ejecutar: psql -h localhost -p 5433 -U novalogic -d novalogic_mcp -f 001_create_simora_v2.sql
-- ============================================================

CREATE SCHEMA IF NOT EXISTS simora_v2;

-- ─── ENUM ────────────────────────────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE simora_v2.data_source AS ENUM (
    'legacy_mongo', 'novalogic', 'onedrive', 'manual'
  );
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ─── dim_sellers ─────────────────────────────────────────────────────────────
-- Vendedores legacy (compatibilidad hacia atrás con ETL 01 y 02)

CREATE TABLE IF NOT EXISTS simora_v2.dim_sellers (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      simora_v2.data_source NOT NULL,
  source_id   VARCHAR(100) NOT NULL,
  full_name   VARCHAR(255),
  email       VARCHAR(255),
  phone       VARCHAR(50),
  role        VARCHAR(50),
  branch      VARCHAR(100),
  is_active   BOOLEAN DEFAULT true,
  raw         JSONB,
  created_at  TIMESTAMPTZ,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_sellers_source UNIQUE (source, source_id)
);

-- ─── dim_employees ───────────────────────────────────────────────────────────
-- Tabla canónica de empleados unificada entre fuentes.
-- novalogic_id → UUID directo al ERP (join nativo con employees.employees)
-- legacy_mongo_id → ObjectId de magibell_legacy.employees
-- dim_seller_id → link a dim_sellers para compatibilidad hacia atrás

CREATE TABLE IF NOT EXISTS simora_v2.dim_employees (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  novalogic_id     UUID,
  legacy_mongo_id  VARCHAR(100),
  dim_seller_id    UUID REFERENCES simora_v2.dim_sellers(id),
  canonical_name   VARCHAR(255) NOT NULL,
  first_name       VARCHAR(100),
  last_name        VARCHAR(150),
  email            VARCHAR(255),
  phone            VARCHAR(50),
  position         VARCHAR(100),
  department       VARCHAR(100),
  hire_date        DATE,
  status           VARCHAR(20)  DEFAULT 'active',
  is_active        BOOLEAN      DEFAULT true,
  sources          TEXT[]       DEFAULT '{}',
  raw              JSONB,
  imported_at      TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT uq_dim_employees_novalogic UNIQUE (novalogic_id),
  CONSTRAINT uq_dim_employees_legacy    UNIQUE (legacy_mongo_id)
);

-- ─── dim_customers ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simora_v2.dim_customers (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source          simora_v2.data_source NOT NULL,
  source_id       VARCHAR(100) NOT NULL,
  full_name       VARCHAR(255),
  first_name      VARCHAR(100),
  last_name       VARCHAR(100),
  email           VARCHAR(255),
  phone           VARCHAR(50),
  document_type   VARCHAR(20),
  document_number VARCHAR(50),
  city            VARCHAR(100),
  department      VARCHAR(100),
  address         TEXT,
  raw             JSONB,
  created_at      TIMESTAMPTZ,
  imported_at     TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_customers_source UNIQUE (source, source_id)
);

-- ─── dim_products ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simora_v2.dim_products (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source      simora_v2.data_source NOT NULL,
  source_id   VARCHAR(100) NOT NULL,
  sku         VARCHAR(100),
  name        VARCHAR(255),
  category    VARCHAR(100),
  brand       VARCHAR(100) DEFAULT 'Magibell',
  unit_price  NUMERIC(14,2),
  cost_price  NUMERIC(14,2),
  is_active   BOOLEAN DEFAULT true,
  raw         JSONB,
  created_at  TIMESTAMPTZ,
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_products_source UNIQUE (source, source_id)
);

-- ─── fact_orders ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simora_v2.fact_orders (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  source            simora_v2.data_source NOT NULL,
  source_id         VARCHAR(100) NOT NULL,
  tracking_code     VARCHAR(50),
  customer_id       UUID REFERENCES simora_v2.dim_customers(id),
  seller_id         UUID REFERENCES simora_v2.dim_sellers(id),
  dim_employee_id   UUID REFERENCES simora_v2.dim_employees(id),
  order_date        TIMESTAMPTZ,
  delivery_date     DATE,
  subtotal          NUMERIC(14,2),
  iva               NUMERIC(14,2),
  shipping_cost     NUMERIC(14,2),
  discount          NUMERIC(14,2) DEFAULT 0,
  total             NUMERIC(14,2),
  payment_type      VARCHAR(80),
  payment_status    VARCHAR(50),
  has_payment_proof BOOLEAN DEFAULT false,
  guide_number      VARCHAR(100),
  city              VARCHAR(100),
  department        VARCHAR(100),
  carrier           VARCHAR(100),
  delivery_status   VARCHAR(50),
  item_count        INT,
  raw               JSONB,
  imported_at       TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_orders_source UNIQUE (source, source_id)
);

-- ─── fact_order_items ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simora_v2.fact_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES simora_v2.fact_orders(id) ON DELETE CASCADE,
  product_id        UUID REFERENCES simora_v2.dim_products(id),
  source_product_id VARCHAR(100),
  product_name      VARCHAR(255),
  quantity          INT,
  unit_price        NUMERIC(14,2),
  total             NUMERIC(14,2),
  imported_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─── fact_guides ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simora_v2.fact_guides (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source                 simora_v2.data_source NOT NULL,
  source_id              VARCHAR(100) NOT NULL,
  guide_number           VARCHAR(100),
  order_id               UUID REFERENCES simora_v2.fact_orders(id),
  customer_id            UUID REFERENCES simora_v2.dim_customers(id),
  dim_employee_id        UUID REFERENCES simora_v2.dim_employees(id),
  carrier                VARCHAR(100),
  destination_city       VARCHAR(100),
  destination_department VARCHAR(100),
  ship_date              DATE,
  delivery_date          DATE,
  status                 VARCHAR(50),
  declared_value         NUMERIC(14,2),
  shipping_cost          NUMERIC(14,2),
  raw                    JSONB,
  imported_at            TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT uq_guides_source UNIQUE (source, source_id)
);

-- ─── fact_courier_reports ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simora_v2.fact_courier_reports (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file      VARCHAR(100) NOT NULL,
  report_date      DATE         NOT NULL,
  guide_number     VARCHAR(50),
  declared_value   NUMERIC(14,2),
  shipping_cost    NUMERIC(14,2),
  destination      VARCHAR(150),
  visit_number     VARCHAR(20),
  status           VARCHAR(80),
  cash_collected   NUMERIC(14,2),
  customer_name    VARCHAR(255),
  description      TEXT,
  etl_run_id       UUID,
  imported_at      TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT uq_courier_file_guide UNIQUE (source_file, guide_number, report_date)
);

-- ─── fact_bank_transactions ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simora_v2.fact_bank_transactions (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  source_file      VARCHAR(100) NOT NULL,
  account_number   VARCHAR(30)  NOT NULL,
  transaction_date DATE         NOT NULL,
  description      VARCHAR(255),
  branch           VARCHAR(100),
  document         VARCHAR(100),
  amount           NUMERIC(14,2) NOT NULL,
  balance          NUMERIC(14,2),
  etl_run_id       UUID,
  imported_at      TIMESTAMPTZ  DEFAULT NOW(),
  CONSTRAINT uq_bank_txn UNIQUE (source_file, transaction_date, description, amount)
);

-- ─── etl_runs ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS simora_v2.etl_runs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_slug       VARCHAR(50) NOT NULL,
  source             simora_v2.data_source NOT NULL,
  entity             VARCHAR(100) NOT NULL,
  started_at         TIMESTAMPTZ DEFAULT NOW(),
  finished_at        TIMESTAMPTZ,
  records_processed  INT DEFAULT 0,
  records_inserted   INT DEFAULT 0,
  records_updated    INT DEFAULT 0,
  records_failed     INT DEFAULT 0,
  status             VARCHAR(20) DEFAULT 'running',
  error_log          TEXT,
  metadata           JSONB
);

-- ─── INDEXES ─────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_sv2_emp_name     ON simora_v2.dim_employees(canonical_name);
CREATE INDEX IF NOT EXISTS idx_sv2_emp_nova     ON simora_v2.dim_employees(novalogic_id);
CREATE INDEX IF NOT EXISTS idx_sv2_emp_legacy   ON simora_v2.dim_employees(legacy_mongo_id);
CREATE INDEX IF NOT EXISTS idx_sv2_emp_seller   ON simora_v2.dim_employees(dim_seller_id);

CREATE INDEX IF NOT EXISTS idx_sv2_orders_date      ON simora_v2.fact_orders(order_date);
CREATE INDEX IF NOT EXISTS idx_sv2_orders_customer  ON simora_v2.fact_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_sv2_orders_seller    ON simora_v2.fact_orders(seller_id);
CREATE INDEX IF NOT EXISTS idx_sv2_orders_employee  ON simora_v2.fact_orders(dim_employee_id);
CREATE INDEX IF NOT EXISTS idx_sv2_orders_total     ON simora_v2.fact_orders(total);
CREATE INDEX IF NOT EXISTS idx_sv2_orders_tracking  ON simora_v2.fact_orders(tracking_code);
CREATE INDEX IF NOT EXISTS idx_sv2_orders_source    ON simora_v2.fact_orders(source);

CREATE INDEX IF NOT EXISTS idx_sv2_items_order      ON simora_v2.fact_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_sv2_items_product    ON simora_v2.fact_order_items(product_id);

CREATE INDEX IF NOT EXISTS idx_sv2_guides_order     ON simora_v2.fact_guides(order_id);
CREATE INDEX IF NOT EXISTS idx_sv2_guides_number    ON simora_v2.fact_guides(guide_number);
CREATE INDEX IF NOT EXISTS idx_sv2_guides_employee  ON simora_v2.fact_guides(dim_employee_id);

CREATE INDEX IF NOT EXISTS idx_sv2_customers_city   ON simora_v2.dim_customers(city, department);
CREATE INDEX IF NOT EXISTS idx_sv2_etl_company      ON simora_v2.etl_runs(company_slug, source, entity);

CREATE INDEX IF NOT EXISTS idx_sv2_courier_date     ON simora_v2.fact_courier_reports(report_date);
CREATE INDEX IF NOT EXISTS idx_sv2_courier_guide    ON simora_v2.fact_courier_reports(guide_number);
CREATE INDEX IF NOT EXISTS idx_sv2_courier_status   ON simora_v2.fact_courier_reports(status);

CREATE INDEX IF NOT EXISTS idx_sv2_bank_date        ON simora_v2.fact_bank_transactions(transaction_date);
CREATE INDEX IF NOT EXISTS idx_sv2_bank_amount      ON simora_v2.fact_bank_transactions(amount);
CREATE INDEX IF NOT EXISTS idx_sv2_bank_account     ON simora_v2.fact_bank_transactions(account_number);
