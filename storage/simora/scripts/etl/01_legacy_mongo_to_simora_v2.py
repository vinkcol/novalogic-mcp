"""
ETL: magibell_legacy (MongoDB) → simora_v2 (PostgreSQL novalogic_mcp)
========================================================================
Fuente  : Docker container magibell-mongodb, puerto 27019, DB magibell_legacy
Destino : novalogic_mcp.simora_v2 via simora_db (psycopg2 directo)
Ejecutar: python 01_legacy_mongo_to_simora_v2.py [--params '{"batch_size": 500}']

Colecciones mapeadas:
  sellers + employees → dim_sellers + dim_employees
  customers           → dim_customers   (con resolución de addressList → addressitems)
  products            → dim_products
  orders              → fact_orders + fact_order_items + fact_guides

Campos reales del legacy (inspeccionados 2026-04-17):
  customers:    nombres, cedula, celular, addressList[ObjectId→addressitems], created_at(str)
  addressitems: ciudad, departamento, localidad, barrio, direccion
  sellers:      employee(ObjectId ref), active
  employees:    name, lastName, DNI, branchStore, position
  products:     name, price, category, isActive, createdAt(datetime)
  orders:       envio{datos,guia,fechaEntrega}, pedido{productos[]},
                pago{tipo,comprobante}, cobros{subtotal,IVA,total,cantProductos},
                costos{envio}, cliente(ObjectId), sellerID(ObjectId), created_at(datetime)

Nota: addressList contiene ObjectIds que referencian la colección addressitems.
  Se pre-carga addressitems completa en memoria y se resuelve por cada cliente.
  Se usa la ÚLTIMA dirección de la lista (más reciente).
  locality solo se mapea para pedidos en Bogotá (localidades bogotanas).
"""

import argparse
import json
import sys
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pymongo import MongoClient

# Añadir utils/ al path para importar simora_db
sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

# ─── CONFIG ────────────────────────────────────────────────────

MONGO_URI  = "mongodb://magibell:magibell2026@localhost:27019/magibell_legacy?authSource=admin"
COMPANY    = "simora"
SOURCE     = "legacy_mongo"
BATCH_SIZE = 200

# ─── HELPERS ───────────────────────────────────────────────────

def oid(doc: dict, field: str = "_id") -> str | None:
    v = doc.get(field)
    return str(v) if v else None

def to_iso(v) -> str | None:
    """Convierte datetime → ISO string; devuelve None si no parseable."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat()
    if isinstance(v, str) and len(v) > 10:
        if v[:4].isdigit() and "-" in v:
            return v.replace(" ", "T")
    return None

def clean_phone(v) -> str | None:
    if not v:
        return None
    try:
        return str(int(float(v)))[:50]
    except Exception:
        return str(v)[:50] or None

def clean_number(v) -> str | None:
    """Cedula/DNI: skip 0 values."""
    if not v:
        return None
    try:
        n = int(float(v))
        return str(n) if n > 0 else None
    except Exception:
        return str(v)[:50] or None

def clean_payment_type(raw: str | None) -> str | None:
    """Normaliza las 15+ variantes de tipo de pago del legacy."""
    if not raw:
        return None
    r = raw.strip().lower()
    if "contra" in r:
        return "Contraentrega"
    if "anticip" in r:
        return "Anticipado"
    if "al cobro" in r or ("cobro" in r and "sin" not in r):
        return "Al Cobro"
    if "sin cobro" in r:
        return "Sin Cobro"
    if "casa" in r:
        return "Pago en casa"
    if "contado" in r:
        return "Contado"
    return raw.strip()[:80]

def batches(lst: list, size: int):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]

# ─── TRANSFORM FUNCTIONS ───────────────────────────────────────

def transform_seller(doc: dict, employees_by_id: dict) -> dict:
    """
    Seller doc: {employee: ObjectId, active: bool}
    Employee doc: {name, lastName, position, branchStore, DNI}
    """
    emp   = employees_by_id.get(str(doc.get("employee", ""))) or {}
    first = (emp.get("name") or "").strip()
    last  = (emp.get("lastName") or "").strip()
    full  = f"{first} {last}".strip() or "Sin nombre"
    return {
        "source":     SOURCE,
        "source_id":  oid(doc),
        "full_name":  full,
        "email":      emp.get("email"),
        "phone":      clean_phone(emp.get("phone") or emp.get("celular")),
        "role":       emp.get("position") or "seller",
        "branch":     str(emp.get("branchStore", "")) or None,
        "is_active":  bool(doc.get("active", True)),
        "raw":        {},
        "created_at": None,
    }

def transform_employee(emp_doc: dict, seller_doc: dict | None) -> dict:
    """Convierte employee de MongoDB → dim_employees row."""
    first = (emp_doc.get("name") or "").strip()
    last  = (emp_doc.get("lastName") or "").strip()
    full  = f"{first} {last}".strip() or "Sin nombre"
    return {
        "legacy_mongo_id": oid(emp_doc),
        "dim_seller_id":   None,   # se resuelve después del upsert de sellers
        "canonical_name":  full,
        "first_name":      first or None,
        "last_name":       last or None,
        "email":           emp_doc.get("email"),
        "phone":           clean_phone(emp_doc.get("phone") or emp_doc.get("celular")),
        "position":        emp_doc.get("position"),
        "department":      str(emp_doc.get("branchStore", "")) or None,
        "status":          "active" if emp_doc.get("active", True) else "inactive",
        "is_active":       bool(emp_doc.get("active", True)),
        "sources":         [SOURCE],
        "raw":             {},
    }

def transform_customer(doc: dict, addressitems_by_id: dict) -> dict:
    """
    Convierte customer de MongoDB → dim_customers row.
    addressitems_by_id: mapa str(ObjectId) → {city, department, locality, neighborhood, address}
    pre-cargado desde la colección addressitems.
    Se usa la ÚLTIMA dirección de addressList (más reciente).
    locality solo se mapea para Bogotá.
    """
    name  = (doc.get("nombres") or doc.get("name") or "").strip()
    parts = name.split(" ", 1)

    # Resolver dirección desde addressList → addressitems
    addr_list  = doc.get("addressList") or []
    best_addr  = {}
    for item in reversed(addr_list):          # reversed: último = más reciente
        item_id = str(item)
        if item_id in addressitems_by_id:
            best_addr = addressitems_by_id[item_id]
            break

    city     = best_addr.get("city") or doc.get("city") or doc.get("ciudad") or None
    dept     = best_addr.get("department") or doc.get("department") or doc.get("departamento") or None
    address  = best_addr.get("address") or doc.get("address") or doc.get("direccion") or None
    # locality solo aplica a Bogotá (localidades bogotanas)
    locality = best_addr.get("locality") if city == "Bogotá" else None
    neigh    = best_addr.get("neighborhood") or None

    return {
        "source":          SOURCE,
        "source_id":       oid(doc),
        "full_name":       name or None,
        "first_name":      parts[0] if parts[0] else None,
        "last_name":       parts[1] if len(parts) > 1 else None,
        "email":           doc.get("email"),
        "phone":           clean_phone(doc.get("celular") or doc.get("phone") or doc.get("telefono")),
        "document_type":   "CC" if doc.get("cedula") else None,
        "document_number": clean_number(doc.get("cedula") or doc.get("document")),
        "city":            city,
        "department":      dept,
        "address":         address,
        "locality":        locality,
        "neighborhood":    neigh,
        "raw":             {},
        "created_at":      to_iso(doc.get("createdAt") or doc.get("created_at")),
    }

def transform_product(doc: dict) -> dict:
    price = doc.get("price") or doc.get("precio") or doc.get("salePrice") or doc.get("precioVenta")
    return {
        "source":     SOURCE,
        "source_id":  oid(doc),
        "sku":        doc.get("sku") or doc.get("ref") or doc.get("reference"),
        "name":       doc.get("name") or doc.get("nombre") or "Producto sin nombre",
        "category":   doc.get("category") or doc.get("categoria") or None,
        "brand":      "Magibell",
        "unit_price": float(price) if price else None,
        "cost_price": float(doc.get("cost") or doc.get("costo") or 0) or None,
        "is_active":  bool(doc.get("isActive", doc.get("active", True))),
        "raw":        {},
        "created_at": to_iso(doc.get("createdAt") or doc.get("created_at")),
    }

def transform_order(doc: dict) -> dict:
    cobros = doc.get("cobros") or {}
    costos = doc.get("costos") or {}
    envio  = doc.get("envio") or {}
    pago   = doc.get("pago") or {}
    comp   = pago.get("comprobante") or {}
    datos  = envio.get("datos") or {}
    guide  = envio.get("guia")

    city = datos.get("ciudad") or None
    loc  = datos.get("localidad")
    if loc in (None, "None", ""):
        loc = None
    # locality solo aplica a Bogotá
    locality = loc if city == "Bogotá" else None

    return {
        "source":             SOURCE,
        "source_id":          oid(doc),
        "tracking_code":      str(guide)[:50] if guide else None,
        "customer_source_id": oid(doc, "cliente"),
        "seller_source_id":   oid(doc, "sellerID"),
        "order_date":         to_iso(doc.get("created_at")),
        "delivery_date":      envio.get("fechaEntrega"),
        "subtotal":           float(cobros.get("subtotal") or 0) or None,
        "iva":                float(cobros.get("IVA") or 0) or None,
        "shipping_cost":      float(costos.get("envio") or 0) or None,
        "discount":           float(cobros.get("descuento") or 0),
        "total":              float(cobros.get("total") or 0) or None,
        "payment_type":       clean_payment_type(pago.get("tipo")),
        "payment_status":     "paid" if comp.get("validated") else "pending",
        "has_payment_proof":  bool(comp.get("url")),
        "guide_number":       str(guide)[:100] if guide else None,
        "city":               city,
        "department":         datos.get("departamento") or None,
        "locality":           locality,
        "neighborhood":       datos.get("barrio") or None,
        "address":            datos.get("direccion") or None,
        "carrier":            None,
        "delivery_status":    "delivered" if envio.get("fechaEntrega") else "pending",
        "item_count":         int(cobros.get("cantProductos") or 0) or None,
        "raw":                {},
    }

def transform_guide(order_doc: dict) -> dict | None:
    envio  = order_doc.get("envio") or {}
    cobros = order_doc.get("cobros") or {}
    costos = order_doc.get("costos") or {}
    datos  = envio.get("datos") or {}
    guide  = envio.get("guia")

    if not guide:
        return None

    return {
        "source":                 SOURCE,
        "source_id":              oid(order_doc),
        "guide_number":           str(guide)[:100],
        "order_source_id":        oid(order_doc),
        "customer_source_id":     oid(order_doc, "cliente"),
        "carrier":                None,
        "destination_city":       datos.get("ciudad"),
        "destination_department": datos.get("departamento"),
        "ship_date":              to_iso(order_doc.get("created_at")),
        "delivery_date":          envio.get("fechaEntrega"),
        "status":                 "delivered" if envio.get("fechaEntrega") else "in_transit",
        "declared_value":         float(cobros.get("total") or 0) or None,
        "shipping_cost":          float(costos.get("envio") or 0) or None,
        "raw":                    {},
    }

def transform_order_items(doc: dict, products_by_id: dict) -> list[dict]:
    """
    products_by_id: mapa str(ObjectId) → product_name, pre-cargado desde
    la colección products de MongoDB.
    """
    items = []
    for p in (doc.get("pedido") or {}).get("productos", []):
        qty        = max(int(p.get("cantidad") or 1), 1)
        total      = float(p.get("total") or 0)
        src_pid    = oid(p, "producto")
        prod_name  = products_by_id.get(src_pid, "") if src_pid else ""
        items.append({
            "source_product_id": src_pid,
            "product_name":      prod_name or None,
            "quantity":          qty,
            "unit_price":        round(total / qty, 2),
            "total":             total,
        })
    return items

# ─── MAIN ETL ──────────────────────────────────────────────────

def run(params: dict) -> dict:
    batch_size = params.get("batch_size", BATCH_SIZE)
    stats: dict[str, Any] = {
        "started_at": datetime.now(timezone.utc).isoformat(),
        "entities": {},
    }

    mcp_conn = simora_db.get_conn()
    run_id   = simora_db.etl_start(mcp_conn, COMPANY, SOURCE, "all",
                                   {"batch_size": batch_size, "script": "01_legacy_mongo_to_simora_v2"})

    mongo = MongoClient(MONGO_URI)
    db    = mongo["magibell_legacy"]

    total_inserted = total_updated = total_failed = 0

    try:
        # ── Sellers (join with employees) ─────────────────────────
        employees     = {str(e["_id"]): e for e in db.employees.find({})}
        sellers       = list(db.sellers.find({}))
        seller_rows   = [transform_seller(s, employees) for s in sellers]
        if seller_rows:
            ins, upd = simora_db.upsert_sellers(mcp_conn, seller_rows)
            stats["entities"]["sellers"] = {"inserted": ins, "updated": upd}
            total_inserted += ins
            total_updated  += upd
        print(f"[sellers] {stats['entities'].get('sellers')}", file=sys.stderr)

        # ── Employees (dim_employees legacy) ─────────────────────
        emp_rows = [transform_employee(e, None) for e in employees.values()]
        if emp_rows:
            ins, upd = simora_db.upsert_employees(mcp_conn, emp_rows)
            stats["entities"]["employees"] = {"inserted": ins, "updated": upd}
            total_inserted += ins
            total_updated  += upd
        print(f"[employees] {stats['entities'].get('employees')}", file=sys.stderr)

        # ── Customers ────────────────────────────────────────────
        # Pre-cargar addressitems para resolver addressList → dirección completa
        print("[addressitems] cargando...", file=sys.stderr)
        addressitems_by_id = {}
        for ai in db.addressitems.find({}):
            loc = ai.get("localidad")
            addressitems_by_id[str(ai["_id"])] = {
                "city":         ai.get("ciudad") or "",
                "department":   ai.get("departamento") or "",
                "locality":     loc if loc not in (None, "None", "") else None,
                "neighborhood": ai.get("barrio") or None,
                "address":      ai.get("direccion") or None,
            }
        print(f"[addressitems] {len(addressitems_by_id):,} cargados", file=sys.stderr)

        c_ins = c_upd = 0
        all_customers = list(db.customers.find({}))
        for i, batch in enumerate(batches(all_customers, batch_size)):
            rows = [transform_customer(c, addressitems_by_id) for c in batch]
            ins, upd = simora_db.upsert_customers(mcp_conn, rows)
            c_ins += ins
            c_upd += upd
            print(f"[customers] batch {i+1}: +{ins} ins / {upd} upd", file=sys.stderr)
        stats["entities"]["customers"] = {"inserted": c_ins, "updated": c_upd}
        total_inserted += c_ins
        total_updated  += c_upd

        # ── Products ─────────────────────────────────────────────
        products = list(db.products.find({}))
        prod_rows = [transform_product(p) for p in products]
        if prod_rows:
            ins, upd = simora_db.upsert_products(mcp_conn, prod_rows)
            stats["entities"]["products"] = {"inserted": ins, "updated": upd}
            total_inserted += ins
            total_updated  += upd
        print(f"[products] {stats['entities'].get('products')}", file=sys.stderr)

        # ── Orders + Items ───────────────────────────────────────
        # Pre-cargar products para resolver product_name en order_items
        print("[products-lookup] cargando para order items...", file=sys.stderr)
        products_by_id = {str(p["_id"]): (p.get("name") or "").strip()
                          for p in db.products.find({})}
        print(f"[products-lookup] {len(products_by_id):,} productos", file=sys.stderr)

        o_ins = o_upd = o_fail = 0
        ORDER_BATCH  = min(50, batch_size)
        all_orders   = list(db.orders.find({}))
        total_batches = (len(all_orders) + ORDER_BATCH - 1) // ORDER_BATCH

        for i, batch in enumerate(batches(all_orders, ORDER_BATCH)):
            order_rows = [transform_order(o) for o in batch]
            try:
                ins, upd = simora_db.upsert_orders(mcp_conn, order_rows)
                o_ins += ins
                o_upd += upd
            except Exception as e:
                o_fail += len(batch)
                print(f"[orders] batch {i+1} FAILED: {e}", file=sys.stderr)
                continue

            order_items_payload = []
            for o in batch:
                items = transform_order_items(o, products_by_id)
                if items:
                    order_items_payload.append({"source_id": oid(o), "items": items})
            if order_items_payload:
                try:
                    simora_db.upsert_order_items_bulk(mcp_conn, SOURCE, order_items_payload)
                except Exception as e:
                    print(f"[order-items] batch {i+1} FAILED: {e}", file=sys.stderr)

            if (i + 1) % 20 == 0:
                print(f"[orders] batch {i+1}/{total_batches}: {o_ins} ins, {o_upd} upd", file=sys.stderr)

        print(f"[orders] DONE: {o_ins} ins, {o_upd} upd, {o_fail} fail", file=sys.stderr)
        stats["entities"]["orders"] = {"inserted": o_ins, "updated": o_upd, "failed": o_fail}
        total_inserted += o_ins
        total_updated  += o_upd
        total_failed   += o_fail

        # ── Guides (derived from orders with guide numbers) ───────
        g_ins = g_upd = 0
        guide_rows = [g for o in all_orders if (g := transform_guide(o)) is not None]
        print(f"[guides] {len(guide_rows)} orders have guide numbers", file=sys.stderr)
        for i, batch in enumerate(batches(guide_rows, ORDER_BATCH)):
            try:
                ins, upd = simora_db.upsert_guides(mcp_conn, batch)
                g_ins += ins
                g_upd += upd
            except Exception as e:
                print(f"[guides] batch {i+1} FAILED: {e}", file=sys.stderr)
            if (i + 1) % 20 == 0:
                total_g = (len(guide_rows) + ORDER_BATCH - 1) // ORDER_BATCH
                print(f"[guides] batch {i+1}/{total_g}: {g_ins} ins, {g_upd} upd", file=sys.stderr)
        print(f"[guides] DONE: {g_ins} ins, {g_upd} upd", file=sys.stderr)
        stats["entities"]["guides"] = {"inserted": g_ins, "updated": g_upd}
        total_inserted += g_ins
        total_updated  += g_upd

    except Exception as e:
        mongo.close()
        simora_db.etl_finish(mcp_conn, run_id,
                             total_inserted + total_updated + total_failed,
                             total_inserted, total_updated, total_failed,
                             status="failed", error_log=str(e))
        mcp_conn.close()
        stats["status"] = "failed"
        stats["error"]  = str(e)
        return stats

    mongo.close()
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
    parser.add_argument("--dataset", help="(unused por este script)")
    parser.add_argument("--params",  default="{}", help="JSON params")
    args = parser.parse_args()

    params = json.loads(args.params)
    result = run(params)
    print(json.dumps(result, default=str))
    sys.exit(0 if result.get("status") == "completed" else 1)
