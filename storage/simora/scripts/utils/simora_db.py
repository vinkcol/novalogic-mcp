"""
simora_db.py — Conexión y upserts directos a novalogic_mcp.simora_v2
=====================================================================
Todas las escrituras del pipeline ETL van aquí.
Target: novalogic-mcp-db (puerto 5433, db novalogic_mcp)

NO usar para leer datos de la API de Novalogic (novalogic_erp_n).
Ese acceso va por la Internal API o por un DSN separado de solo lectura.
"""

import json
import os
from typing import Any

import psycopg2
import psycopg2.extras

# ─── CONFIG ──────────────────────────────────────────────────────────────────

MCP_DSN = os.getenv(
    "SIMORA_DB_DSN",
    "host=localhost port=5433 dbname=novalogic_mcp user=novalogic password=novalogic_mcp_2024",
)


def get_conn():
    """Retorna una conexión a novalogic_mcp con autocommit=False."""
    conn = psycopg2.connect(MCP_DSN)
    conn.autocommit = False
    return conn


def _q(cur, sql, params=None):
    if params:
        cur.execute(sql, params)
    else:
        cur.execute(sql)
    return cur.fetchall()


# ─── ETL RUNS ─────────────────────────────────────────────────────────────────

def etl_start(conn, company_slug: str, source: str, entity: str, metadata: dict = None) -> str:
    with conn.cursor() as cur:
        cur.execute(
            """INSERT INTO simora_v2.etl_runs
                 (company_slug, source, entity, metadata)
               VALUES (%s, %s, %s, %s) RETURNING id""",
            [company_slug, source, entity, json.dumps(metadata or {})],
        )
        run_id = cur.fetchone()[0]
    conn.commit()
    return str(run_id)


def etl_finish(conn, run_id: str, processed: int, inserted: int,
               updated: int, failed: int, status: str = "completed", error_log: str = None):
    with conn.cursor() as cur:
        cur.execute(
            """UPDATE simora_v2.etl_runs
               SET finished_at = NOW(), status = %s,
                   records_processed = %s, records_inserted = %s,
                   records_updated   = %s, records_failed   = %s,
                   error_log = %s
               WHERE id = %s""",
            [status, processed, inserted, updated, failed, error_log, run_id],
        )
    conn.commit()


# ─── UPSERT HELPERS ──────────────────────────────────────────────────────────

def _is_insert(cur) -> bool:
    row = cur.fetchone()
    return bool(row[0]) if row else False


def upsert_sellers(conn, rows: list[dict]) -> tuple[int, int]:
    ins = upd = 0
    with conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO simora_v2.dim_sellers
                     (source, source_id, full_name, email, phone, role, branch, is_active, raw, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source, source_id) DO UPDATE SET
                     full_name = EXCLUDED.full_name, email = EXCLUDED.email,
                     role = EXCLUDED.role, raw = EXCLUDED.raw, imported_at = NOW()
                   RETURNING (xmax = 0) AS is_insert""",
                [r["source"], r["source_id"], r.get("full_name"), r.get("email"),
                 r.get("phone"), r.get("role"), r.get("branch"),
                 r.get("is_active", True), json.dumps(r.get("raw", {})), r.get("created_at")],
            )
            if _is_insert(cur): ins += 1
            else: upd += 1
    conn.commit()
    return ins, upd


def upsert_employees(conn, rows: list[dict]) -> tuple[int, int]:
    """
    Upsert en dim_employees.
    Cada row puede tener:
      novalogic_id (UUID), legacy_mongo_id (str), canonical_name, first_name, last_name,
      email, phone, position, department, hire_date, status, is_active,
      sources (list[str]), dim_seller_id (UUID), raw (dict)
    Upsert por novalogic_id si existe, sino por legacy_mongo_id.
    """
    ins = upd = 0
    with conn.cursor() as cur:
        for r in rows:
            nid = r.get("novalogic_id")
            lid = r.get("legacy_mongo_id")

            if nid:
                cur.execute(
                    """INSERT INTO simora_v2.dim_employees
                         (novalogic_id, legacy_mongo_id, dim_seller_id, canonical_name,
                          first_name, last_name, email, phone, position, department,
                          hire_date, status, is_active, sources, raw)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (novalogic_id) DO UPDATE SET
                         legacy_mongo_id = COALESCE(EXCLUDED.legacy_mongo_id, simora_v2.dim_employees.legacy_mongo_id),
                         dim_seller_id   = COALESCE(EXCLUDED.dim_seller_id, simora_v2.dim_employees.dim_seller_id),
                         canonical_name  = EXCLUDED.canonical_name,
                         email           = EXCLUDED.email,
                         phone           = EXCLUDED.phone,
                         position        = EXCLUDED.position,
                         department      = EXCLUDED.department,
                         status          = EXCLUDED.status,
                         is_active       = EXCLUDED.is_active,
                         sources         = EXCLUDED.sources,
                         raw             = EXCLUDED.raw,
                         imported_at     = NOW()
                       RETURNING (xmax = 0) AS is_insert""",
                    [nid, lid, r.get("dim_seller_id"), r["canonical_name"],
                     r.get("first_name"), r.get("last_name"), r.get("email"), r.get("phone"),
                     r.get("position"), r.get("department"), r.get("hire_date"),
                     r.get("status", "active"), r.get("is_active", True),
                     r.get("sources", []), json.dumps(r.get("raw", {}))],
                )
            else:
                cur.execute(
                    """INSERT INTO simora_v2.dim_employees
                         (legacy_mongo_id, dim_seller_id, canonical_name,
                          first_name, last_name, email, phone, position,
                          status, is_active, sources, raw)
                       VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                       ON CONFLICT (legacy_mongo_id) DO UPDATE SET
                         dim_seller_id  = COALESCE(EXCLUDED.dim_seller_id, simora_v2.dim_employees.dim_seller_id),
                         canonical_name = EXCLUDED.canonical_name,
                         email          = EXCLUDED.email,
                         position       = EXCLUDED.position,
                         status         = EXCLUDED.status,
                         is_active      = EXCLUDED.is_active,
                         sources        = EXCLUDED.sources,
                         raw            = EXCLUDED.raw,
                         imported_at    = NOW()
                       RETURNING (xmax = 0) AS is_insert""",
                    [lid, r.get("dim_seller_id"), r["canonical_name"],
                     r.get("first_name"), r.get("last_name"), r.get("email"), r.get("phone"),
                     r.get("position"), r.get("status", "active"), r.get("is_active", True),
                     r.get("sources", []), json.dumps(r.get("raw", {}))],
                )
            if _is_insert(cur): ins += 1
            else: upd += 1
    conn.commit()
    return ins, upd


def upsert_customers(conn, rows: list[dict]) -> tuple[int, int]:
    ins = upd = 0
    with conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO simora_v2.dim_customers
                     (source, source_id, full_name, first_name, last_name, email, phone,
                      document_type, document_number, city, department, address,
                      locality, neighborhood, raw, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source, source_id) DO UPDATE SET
                     full_name=EXCLUDED.full_name, first_name=EXCLUDED.first_name,
                     last_name=EXCLUDED.last_name, email=EXCLUDED.email, phone=EXCLUDED.phone,
                     city=EXCLUDED.city, department=EXCLUDED.department,
                     address=EXCLUDED.address, locality=EXCLUDED.locality,
                     neighborhood=EXCLUDED.neighborhood,
                     raw=EXCLUDED.raw, imported_at=NOW()
                   RETURNING (xmax = 0) AS is_insert""",
                [r["source"], r["source_id"], r.get("full_name"), r.get("first_name"),
                 r.get("last_name"), r.get("email"), r.get("phone"),
                 r.get("document_type"), r.get("document_number"),
                 r.get("city"), r.get("department"), r.get("address"),
                 r.get("locality"), r.get("neighborhood"),
                 json.dumps(r.get("raw", {})), r.get("created_at")],
            )
            if _is_insert(cur): ins += 1
            else: upd += 1
    conn.commit()
    return ins, upd


def upsert_products(conn, rows: list[dict]) -> tuple[int, int]:
    ins = upd = 0
    with conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO simora_v2.dim_products
                     (source, source_id, sku, name, category, brand, unit_price, cost_price, is_active, raw, created_at)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source, source_id) DO UPDATE SET
                     name=EXCLUDED.name, category=EXCLUDED.category, unit_price=EXCLUDED.unit_price,
                     is_active=EXCLUDED.is_active, raw=EXCLUDED.raw, imported_at=NOW()
                   RETURNING (xmax = 0) AS is_insert""",
                [r["source"], r["source_id"], r.get("sku"), r.get("name"), r.get("category"),
                 r.get("brand", "Magibell"), r.get("unit_price"), r.get("cost_price"),
                 r.get("is_active", True), json.dumps(r.get("raw", {})), r.get("created_at")],
            )
            if _is_insert(cur): ins += 1
            else: upd += 1
    conn.commit()
    return ins, upd


def _resolve_fk(cur, table: str, source: str, source_id: str) -> str | None:
    if not source_id:
        return None
    cur.execute(
        f"SELECT id FROM simora_v2.{table} WHERE source=%s AND source_id=%s LIMIT 1",
        [source, source_id],
    )
    row = cur.fetchone()
    return str(row[0]) if row else None


def upsert_orders(conn, rows: list[dict]) -> tuple[int, int]:
    ins = upd = 0
    with conn.cursor() as cur:
        for r in rows:
            cid = _resolve_fk(cur, "dim_customers", r["source"], r.get("customer_source_id", ""))
            sid = _resolve_fk(cur, "dim_sellers",   r["source"], r.get("seller_source_id", ""))
            cur.execute(
                """INSERT INTO simora_v2.fact_orders
                     (source, source_id, tracking_code, customer_id, seller_id,
                      order_date, delivery_date, subtotal, iva, shipping_cost,
                      discount, total, payment_type, payment_status, has_payment_proof,
                      guide_number, city, department, carrier, delivery_status, item_count, raw)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source, source_id) DO UPDATE SET
                     tracking_code=EXCLUDED.tracking_code, total=EXCLUDED.total,
                     payment_type=EXCLUDED.payment_type, delivery_status=EXCLUDED.delivery_status,
                     guide_number=EXCLUDED.guide_number, raw=EXCLUDED.raw, imported_at=NOW()
                   RETURNING (xmax = 0) AS is_insert""",
                [r["source"], r["source_id"], r.get("tracking_code"), cid, sid,
                 r.get("order_date"), r.get("delivery_date"),
                 r.get("subtotal"), r.get("iva"), r.get("shipping_cost"),
                 r.get("discount", 0), r.get("total"),
                 r.get("payment_type"), r.get("payment_status"), r.get("has_payment_proof", False),
                 r.get("guide_number"), r.get("city"), r.get("department"),
                 r.get("carrier"), r.get("delivery_status"), r.get("item_count"),
                 json.dumps(r.get("raw", {}))],
            )
            if _is_insert(cur): ins += 1
            else: upd += 1
    conn.commit()
    return ins, upd


def upsert_order_items_bulk(conn, source: str, orders: list[dict]) -> tuple[int, int]:
    """orders = [{ source_id, items: [{source_product_id, product_name, quantity, unit_price, total}] }]"""
    source_ids = [o["source_id"] for o in orders]
    if not source_ids:
        return 0, 0

    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        placeholders = ",".join(["%s"] * len(source_ids))
        cur.execute(
            f"SELECT id, source_id FROM simora_v2.fact_orders WHERE source=%s AND source_id IN ({placeholders})",
            [source, *source_ids],
        )
        id_map = {r["source_id"]: str(r["id"]) for r in cur.fetchall()}

    items_inserted = 0
    with conn.cursor() as cur:
        for order in orders:
            order_id = id_map.get(order["source_id"])
            if not order_id or not order.get("items"):
                continue
            cur.execute("DELETE FROM simora_v2.fact_order_items WHERE order_id = %s", [order_id])
            for item in order["items"]:
                cur.execute(
                    """INSERT INTO simora_v2.fact_order_items
                         (order_id, product_id, source_product_id, product_name, quantity, unit_price, total)
                       VALUES (%s,
                         (SELECT id FROM simora_v2.dim_products WHERE source_id=%s LIMIT 1),
                         %s,%s,%s,%s,%s)""",
                    [order_id, item.get("source_product_id"), item.get("source_product_id"),
                     item.get("product_name"), item.get("quantity", 1),
                     item.get("unit_price"), item.get("total")],
                )
                items_inserted += 1
    conn.commit()
    return len(id_map), items_inserted


def upsert_guides(conn, rows: list[dict]) -> tuple[int, int]:
    ins = upd = 0
    with conn.cursor() as cur:
        for r in rows:
            oid = _resolve_fk(cur, "fact_orders",   r["source"], r.get("order_source_id", ""))
            cid = _resolve_fk(cur, "dim_customers", r["source"], r.get("customer_source_id", ""))
            cur.execute(
                """INSERT INTO simora_v2.fact_guides
                     (source, source_id, guide_number, order_id, customer_id,
                      carrier, destination_city, destination_department,
                      ship_date, delivery_date, status,
                      declared_value, shipping_cost, raw)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source, source_id) DO UPDATE SET
                     guide_number=EXCLUDED.guide_number,
                     destination_city=EXCLUDED.destination_city,
                     destination_department=EXCLUDED.destination_department,
                     delivery_date=EXCLUDED.delivery_date,
                     status=EXCLUDED.status, raw=EXCLUDED.raw, imported_at=NOW()
                   RETURNING (xmax = 0) AS is_insert""",
                [r["source"], r["source_id"], r.get("guide_number"), oid, cid,
                 r.get("carrier"), r.get("destination_city"), r.get("destination_department"),
                 r.get("ship_date"), r.get("delivery_date"), r.get("status"),
                 r.get("declared_value"), r.get("shipping_cost"),
                 json.dumps(r.get("raw", {}))],
            )
            if _is_insert(cur): ins += 1
            else: upd += 1
    conn.commit()
    return ins, upd


def upsert_courier_reports(conn, rows: list[dict]) -> tuple[int, int]:
    ins = upd = 0
    with conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO simora_v2.fact_courier_reports
                     (source_file, report_date, guide_number, declared_value, shipping_cost,
                      destination, visit_number, status, cash_collected, customer_name,
                      description, etl_run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source_file, guide_number, report_date) DO UPDATE SET
                     declared_value=EXCLUDED.declared_value, shipping_cost=EXCLUDED.shipping_cost,
                     status=EXCLUDED.status, cash_collected=EXCLUDED.cash_collected, imported_at=NOW()
                   RETURNING (xmax = 0) AS is_insert""",
                [r["source_file"], r["report_date"], r.get("guide_number"),
                 r.get("declared_value"), r.get("shipping_cost"), r.get("destination"),
                 r.get("visit_number"), r.get("status"), r.get("cash_collected"),
                 r.get("customer_name"), r.get("description"), r.get("etl_run_id")],
            )
            if _is_insert(cur): ins += 1
            else: upd += 1
    conn.commit()
    return ins, upd


def upsert_bank_transactions(conn, rows: list[dict]) -> tuple[int, int]:
    ins = upd = 0
    with conn.cursor() as cur:
        for r in rows:
            cur.execute(
                """INSERT INTO simora_v2.fact_bank_transactions
                     (source_file, account_number, transaction_date, description,
                      branch, document, amount, balance, etl_run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                   ON CONFLICT (source_file, transaction_date, description, amount) DO UPDATE SET
                     balance=EXCLUDED.balance, imported_at=NOW()
                   RETURNING (xmax = 0) AS is_insert""",
                [r["source_file"], r["account_number"], r["transaction_date"],
                 r.get("description"), r.get("branch"), r.get("document"),
                 r["amount"], r.get("balance"), r.get("etl_run_id")],
            )
            if _is_insert(cur): ins += 1
            else: upd += 1
    conn.commit()
    return ins, upd
