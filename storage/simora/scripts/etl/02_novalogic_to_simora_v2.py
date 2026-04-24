"""
ETL 02: Novalogic ERP (PostgreSQL) → simora_v2 (novalogic_mcp)
================================================================
Fuente  : PostgreSQL novalogic_erp_n (puerto 5436) — solo lectura
Destino : novalogic_mcp.simora_v2 via simora_db (psycopg2 directo)
Ejecutar: python 02_novalogic_to_simora_v2.py [--params '{"batch_size": 200}']

Cubre el periodo Diciembre 2025 → presente (cierra el gap del legacy).

Mapeos:
  employees.employees              → dim_sellers + dim_employees (source: novalogic)
  customers.customers              → dim_customers  (source: novalogic)
  products.products                → dim_products   (source: novalogic)
  sales.sales                      → fact_orders    (source: novalogic)
  sales.sale_items                 → fact_order_items
  logistics.shipments              → fact_guides    (source: novalogic)

Campos reales inspeccionados 2026-04-17:
  sales: id, sale_number, status, customer_id, customer_name, seller_id, seller_name,
         payment_method, subtotal, discount_total, tax_total, shipping_cost, total,
         delivery_date, financial_status, company_id, created_at
  customers: id, first_name, last_name, email, phone, document_type, document_number,
             is_active, company_id, created_at
  products: id, name, sku, price, cost, category_id, is_active, company_id, created_at
  employees: id, first_name, last_name, email, phone, position_id, company_id, created_at
  shipments: id, tracking_number, sale_id, carrier_name, recipient_city,
             recipient_department, shipping_cost, scheduled_delivery_date,
             actual_delivery_date, status, company_id, created_at
"""

import argparse
import json
import sys
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psycopg2
import psycopg2.extras

# Añadir utils/ al path para importar simora_db
sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

# ─── CONFIG ────────────────────────────────────────────────────

# Fuente: novalogic ERP — solo lectura
ERP_DSN = os.getenv(
    "NOVALOGIC_DB_DSN",
    "host=localhost port=5436 dbname=novalogic_erp_n user=novalogic password=novalogic2024",
)
COMPANY_SLUG = "simora"
COMPANY_ID   = "2af87e54-33a6-4a60-9b88-63582d3edacb"
SOURCE       = "novalogic"
BATCH_SIZE   = 200

# ─── HELPERS ───────────────────────────────────────────────────

def to_iso(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, str) and len(v) > 10:
        return v
    return None

def str_or_none(v, max_len: int = 255) -> str | None:
    if v is None:
        return None
    s = str(v).strip()
    return s[:max_len] if s else None

def batches(lst: list, size: int):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]

def clean_payment_method(v: str | None) -> str | None:
    if not v:
        return None
    mapping = {
        "cash":          "Contraentrega",
        "contraentrega": "Contraentrega",
        "prepaid":       "Anticipado",
        "transfer":      "Transferencia",
        "card":          "Tarjeta",
        "nequi":         "Nequi",
        "daviplata":     "Daviplata",
    }
    return mapping.get(v.lower(), v[:80])

# ─── TRANSFORMS ────────────────────────────────────────────────

def transform_seller(row: dict) -> dict:
    first = (row.get("first_name") or "").strip()
    last  = (row.get("last_name") or "").strip()
    return {
        "source":     SOURCE,
        "source_id":  str(row["id"]),
        "full_name":  f"{first} {last}".strip() or "Sin nombre",
        "email":      str_or_none(row.get("email"), 255),
        "phone":      str_or_none(row.get("phone"), 50),
        "role":       "seller",
        "branch":     None,
        "is_active":  row.get("status") != "inactive",
        "raw":        {},
        "created_at": to_iso(row.get("created_at")),
    }

def transform_employee(row: dict) -> dict:
    first = (row.get("first_name") or "").strip()
    last  = (row.get("last_name") or "").strip()
    full  = f"{first} {last}".strip() or "Sin nombre"
    return {
        "novalogic_id":   str(row["id"]),
        "canonical_name": full,
        "first_name":     first or None,
        "last_name":      last or None,
        "email":          str_or_none(row.get("email"), 255),
        "phone":          str_or_none(row.get("phone"), 50),
        "position":       str_or_none(row.get("position_name"), 100),
        "department":     str_or_none(row.get("department_name"), 100),
        "hire_date":      to_iso(row.get("hire_date")),
        "status":         "inactive" if row.get("status") == "inactive" else "active",
        "is_active":      row.get("status") != "inactive",
        "sources":        [SOURCE],
        "raw":            {},
    }

def transform_customer(row: dict) -> dict:
    first = (row.get("first_name") or "").strip()
    last  = (row.get("last_name") or "").strip()
    full  = f"{first} {last}".strip()
    return {
        "source":          SOURCE,
        "source_id":       str(row["id"]),
        "full_name":       full or None,
        "first_name":      first or None,
        "last_name":       last or None,
        "email":           str_or_none(row.get("email"), 255),
        "phone":           str_or_none(row.get("phone"), 50),
        "document_type":   str_or_none(row.get("document_type"), 20),
        "document_number": str_or_none(row.get("document_number"), 50),
        "city":            None,
        "department":      None,
        "address":         None,
        "raw":             {},
        "created_at":      to_iso(row.get("created_at")),
    }

def transform_product(row: dict, categories: dict) -> dict:
    cat_name = categories.get(str(row.get("category_id")))
    price = float(row["price"]) if row.get("price") is not None else None
    cost  = float(row["cost"])  if row.get("cost")  is not None else None
    return {
        "source":     SOURCE,
        "source_id":  str(row["id"]),
        "sku":        str_or_none(row.get("sku"), 100),
        "name":       str_or_none(row.get("name"), 255) or "Producto sin nombre",
        "category":   cat_name,
        "brand":      "Magibell",
        "unit_price": price,
        "cost_price": cost,
        "is_active":  bool(row.get("is_active", True)),
        "raw":        {},
        "created_at": to_iso(row.get("created_at")),
    }

def transform_order(row: dict) -> dict:
    return {
        "source":             SOURCE,
        "source_id":          str(row["id"]),
        "tracking_code":      str_or_none(row.get("tracking_code"), 50),
        "customer_source_id": str(row["customer_id"]) if row.get("customer_id") else None,
        "seller_source_id":   str(row["seller_id"])   if row.get("seller_id")   else None,
        "order_date":         to_iso(row.get("created_at")),
        "delivery_date":      to_iso(row.get("delivery_date")),
        "subtotal":           float(row["subtotal"])       if row.get("subtotal") is not None else None,
        "iva":                float(row["tax_total"])      if row.get("tax_total") is not None else None,
        "shipping_cost":      float(row["shipping_cost"])  if row.get("shipping_cost") is not None else None,
        "discount":           float(row["discount_total"]) if row.get("discount_total") is not None else 0.0,
        "total":              float(row["total"])          if row.get("total") is not None else None,
        "payment_type":       clean_payment_method(row.get("payment_method") or row.get("shipping_type")),
        "payment_status":     row.get("financial_status") or "pending",
        "has_payment_proof":  bool(row.get("receipt_url")),
        "guide_number":       str_or_none(row.get("tracking_code"), 100),
        "city":               None,
        "department":         None,
        "carrier":            None,
        "delivery_status":    "delivered" if row.get("delivery_date") else "pending",
        "item_count":         None,
        "raw":                {},
    }

def transform_order_items(sale_items: list[dict]) -> list[dict]:
    return [
        {
            "source_product_id": str(row["product_id"]) if row.get("product_id") else None,
            "product_name":      str_or_none(row.get("product_name"), 255),
            "quantity":          max(int(float(row.get("quantity") or 1)), 1),
            "unit_price":        float(row["unit_price"]) if row.get("unit_price") is not None else None,
            "total":             float(row["subtotal"])   if row.get("subtotal")   is not None else None,
        }
        for row in sale_items
    ]

def transform_guide(row: dict, sale_source_id: str | None) -> dict:
    status_map = {
        "in_preparation":   "pending",
        "out_for_dispatch": "in_transit",
        "delivered":        "delivered",
        "failed":           "failed",
        "returned":         "returned",
        "cancelled":        "cancelled",
    }
    sched = row.get("scheduled_delivery_date")
    return {
        "source":                 SOURCE,
        "source_id":              str(row["id"]),
        "guide_number":           str_or_none(row.get("tracking_number"), 100),
        "order_source_id":        sale_source_id,
        "customer_source_id":     None,
        "carrier":                str_or_none(row.get("carrier_name"), 100),
        "destination_city":       str_or_none(row.get("recipient_city"), 100),
        "destination_department": str_or_none(row.get("recipient_department"), 100),
        "ship_date":              to_iso(row.get("created_at")),
        "delivery_date":          to_iso(row.get("actual_delivery_date")) or (str(sched) if sched else None),
        "status":                 status_map.get(str(row.get("status", "")), str(row.get("status") or "pending")),
        "declared_value":         None,
        "shipping_cost":          float(row["shipping_cost"]) if row.get("shipping_cost") is not None else None,
        "raw":                    {},
    }

# ─── MAIN ETL ──────────────────────────────────────────────────

def run(params: dict) -> dict:
    batch_size = params.get("batch_size", BATCH_SIZE)
    stats: dict[str, Any] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "entities": {},
    }

    mcp_conn = simora_db.get_conn()
    run_id   = simora_db.etl_start(mcp_conn, COMPANY_SLUG, SOURCE, "all",
                                   {"batch_size": batch_size, "script": "02_novalogic_to_simora_v2"})

    erp_conn = psycopg2.connect(ERP_DSN)
    cur      = erp_conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

    total_inserted = total_updated = total_failed = 0

    try:
        # ── Employees → dim_sellers + dim_employees ───────────────
        cur.execute("""
            SELECT e.id, e.first_name, e.last_name, e.email, e.phone, e.status,
                   e.created_at,
                   NULL AS position_name
            FROM employees.employees e
            WHERE e.company_id = %s AND (e.is_deleted = false OR e.is_deleted IS NULL)
        """, (COMPANY_ID,))
        employees = [dict(r) for r in cur.fetchall()]

        # dim_sellers (backward compat)
        seller_rows = [transform_seller(r) for r in employees]
        if seller_rows:
            ins, upd = simora_db.upsert_sellers(mcp_conn, seller_rows)
            stats["entities"]["sellers"] = {"inserted": ins, "updated": upd}
            total_inserted += ins
            total_updated  += upd
        print(f"[sellers] {stats['entities'].get('sellers')}", file=sys.stderr)

        # dim_employees (canonical)
        emp_rows = [transform_employee(r) for r in employees]
        if emp_rows:
            ins, upd = simora_db.upsert_employees(mcp_conn, emp_rows)
            stats["entities"]["employees"] = {"inserted": ins, "updated": upd}
            total_inserted += ins
            total_updated  += upd
        print(f"[employees] {stats['entities'].get('employees')}", file=sys.stderr)

        # ── Customers ────────────────────────────────────────────
        cur.execute("""
            SELECT id, first_name, last_name, email, phone,
                   document_type, document_number, is_active, created_at
            FROM customers.customers
            WHERE company_id = %s AND is_deleted = false
            ORDER BY created_at
        """, (COMPANY_ID,))
        all_customers = [dict(r) for r in cur.fetchall()]
        c_ins = c_upd = 0
        for i, batch in enumerate(batches(all_customers, batch_size)):
            rows = [transform_customer(r) for r in batch]
            ins, upd = simora_db.upsert_customers(mcp_conn, rows)
            c_ins += ins
            c_upd += upd
            print(f"[customers] batch {i+1}: +{ins} ins / {upd} upd", file=sys.stderr)
        stats["entities"]["customers"] = {"inserted": c_ins, "updated": c_upd}
        total_inserted += c_ins
        total_updated  += c_upd

        # ── Products ─────────────────────────────────────────────
        cur.execute("""
            SELECT id, name, sku, price, cost, category_id, is_active, created_at
            FROM products.products
            WHERE company_id = %s AND is_deleted = false
        """, (COMPANY_ID,))
        products = [dict(r) for r in cur.fetchall()]

        cur.execute("SELECT id, name FROM products.categories WHERE company_id = %s", (COMPANY_ID,))
        categories = {str(r["id"]): r["name"] for r in cur.fetchall()}

        prod_rows = [transform_product(p, categories) for p in products]
        if prod_rows:
            ins, upd = simora_db.upsert_products(mcp_conn, prod_rows)
            stats["entities"]["products"] = {"inserted": ins, "updated": upd}
            total_inserted += ins
            total_updated  += upd
        print(f"[products] {stats['entities'].get('products')}", file=sys.stderr)

        # ── Orders (sales) ───────────────────────────────────────
        cur.execute("""
            SELECT id, sale_number, status, customer_id, customer_name, seller_id, seller_name,
                   payment_method, shipping_type, subtotal, discount_total, tax_total,
                   shipping_cost, total, delivery_date, financial_status,
                   receipt_url, created_at
            FROM sales.sales
            WHERE company_id = %s AND is_deleted = false
            ORDER BY created_at
        """, (COMPANY_ID,))
        all_sales = [dict(r) for r in cur.fetchall()]

        cur.execute("""
            SELECT sale_id, tracking_number
            FROM logistics.shipments
            WHERE company_id = %s AND is_deleted = false
        """, (COMPANY_ID,))
        tracking_by_sale = {str(r["sale_id"]): r["tracking_number"] for r in cur.fetchall()}

        o_ins = o_upd = o_fail = 0
        ORDER_BATCH   = min(50, batch_size)
        total_batches = (len(all_sales) + ORDER_BATCH - 1) // ORDER_BATCH

        for i, batch in enumerate(batches(all_sales, ORDER_BATCH)):
            order_rows = []
            for s in batch:
                d = dict(s)
                d["tracking_code"] = tracking_by_sale.get(str(d["id"]))
                order_rows.append(transform_order(d))
            try:
                ins, upd = simora_db.upsert_orders(mcp_conn, order_rows)
                o_ins += ins
                o_upd += upd
            except Exception as e:
                o_fail += len(batch)
                print(f"[orders] batch {i+1} FAILED: {e}", file=sys.stderr)
                continue

            # Fetch items for this batch from ERP
            sale_ids     = [str(s["id"]) for s in batch]
            placeholders = ",".join(["%s"] * len(sale_ids))
            cur.execute(
                f"SELECT sale_id, product_id, product_name, quantity, unit_price, subtotal "
                f"FROM sales.sale_items "
                f"WHERE sale_id IN ({placeholders}) AND is_deleted = false",
                sale_ids,
            )
            items_by_sale: dict[str, list] = {}
            for item in cur.fetchall():
                sid = str(item["sale_id"])
                items_by_sale.setdefault(sid, []).append(dict(item))

            order_items_payload = [
                {"source_id": str(s["id"]),
                 "items": transform_order_items(items_by_sale.get(str(s["id"]), []))}
                for s in batch
                if items_by_sale.get(str(s["id"]))
            ]
            if order_items_payload:
                try:
                    simora_db.upsert_order_items_bulk(mcp_conn, SOURCE, order_items_payload)
                except Exception as e:
                    print(f"[order-items] batch {i+1} FAILED: {e}", file=sys.stderr)

            if (i + 1) % 10 == 0:
                print(f"[orders] batch {i+1}/{total_batches}: {o_ins} ins, {o_upd} upd", file=sys.stderr)

        print(f"[orders] DONE: {o_ins} ins, {o_upd} upd, {o_fail} fail", file=sys.stderr)
        stats["entities"]["orders"] = {"inserted": o_ins, "updated": o_upd, "failed": o_fail}
        total_inserted += o_ins
        total_updated  += o_upd
        total_failed   += o_fail

        # ── Guides (shipments) ────────────────────────────────────
        cur.execute("""
            SELECT s.id, s.tracking_number, s.sale_id, s.carrier_name,
                   s.recipient_city, s.recipient_department,
                   s.shipping_cost, s.scheduled_delivery_date, s.actual_delivery_date,
                   s.status, s.created_at
            FROM logistics.shipments s
            WHERE s.company_id = %s AND s.is_deleted = false
            ORDER BY s.created_at
        """, (COMPANY_ID,))
        all_shipments = [dict(r) for r in cur.fetchall()]

        g_ins = g_upd = 0
        guide_rows = [transform_guide(s, str(s["sale_id"]) if s["sale_id"] else None)
                      for s in all_shipments]
        for i, batch in enumerate(batches(guide_rows, ORDER_BATCH)):
            try:
                ins, upd = simora_db.upsert_guides(mcp_conn, batch)
                g_ins += ins
                g_upd += upd
            except Exception as e:
                print(f"[guides] batch {i+1} FAILED: {e}", file=sys.stderr)

        print(f"[guides] DONE: {g_ins} ins, {g_upd} upd", file=sys.stderr)
        stats["entities"]["guides"] = {"inserted": g_ins, "updated": g_upd}
        total_inserted += g_ins
        total_updated  += g_upd

    except Exception as e:
        cur.close()
        erp_conn.close()
        simora_db.etl_finish(mcp_conn, run_id,
                             total_inserted + total_updated + total_failed,
                             total_inserted, total_updated, total_failed,
                             status="failed", error_log=str(e))
        mcp_conn.close()
        stats["status"] = "failed"
        stats["error"]  = str(e)
        return stats

    cur.close()
    erp_conn.close()
    total_processed = total_inserted + total_updated + total_failed
    simora_db.etl_finish(mcp_conn, run_id, total_processed,
                         total_inserted, total_updated, total_failed)
    mcp_conn.close()

    stats["run_id"]         = run_id
    stats["status"]         = "completed"
    stats["total_inserted"] = total_inserted
    stats["total_updated"]  = total_updated
    stats["total_failed"]   = total_failed
    stats["finished_at"]    = datetime.now(timezone.utc).isoformat()
    return stats


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dataset", help="(unused)")
    parser.add_argument("--params",  default="{}", help="JSON params")
    args = parser.parse_args()

    params = json.loads(args.params)
    result = run(params)
    print(json.dumps(result, default=str))
    sys.exit(0 if result.get("status") == "completed" else 1)
