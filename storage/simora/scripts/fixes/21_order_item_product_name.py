"""
Fix 21: product_name en fact_order_items desde MongoDB products
===============================================================
25,734 líneas de fact_order_items (legacy_mongo) tienen product_name = NULL
porque el ETL guardaba el ObjectId del producto (source_product_id) pero
nunca resolvía el nombre consultando la colección products.

Estrategia:
  1. Cargar todos los products de MongoDB: {str(_id) → name}
  2. Para cada fact_order_item sin product_name, buscar por source_product_id
  3. Actualizar product_name

También:
  4. Poblar fact_orders.locality, neighborhood, address desde orders.envio.datos
     (fuente inline en cada orden — más precisa que dispatch_log para legacy).

Uso:
  python 21_order_item_product_name.py --dry-run
  python 21_order_item_product_name.py
"""

import sys
import json
import argparse
from pathlib import Path
from pymongo import MongoClient

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

MONGO_URI = "mongodb://magibell:magibell2026@localhost:27019/magibell_legacy?authSource=admin"


def run(dry_run: bool):
    conn = simora_db.get_conn()

    # ── 1. Cargar products de MongoDB ─────────────────────────────────────────
    print("Conectando a MongoDB...")
    client = MongoClient(MONGO_URI)
    db = client["magibell_legacy"]

    print("Cargando products...")
    products_by_id = {str(p["_id"]): (p.get("name") or "").strip()
                      for p in db.products.find({})}
    print(f"  {len(products_by_id):,} productos en MongoDB")

    # ── 2. Cargar fact_order_items sin product_name ───────────────────────────
    print("\nCargando fact_order_items sin product_name...")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, source_product_id
            FROM simora_v2.fact_order_items
            WHERE (product_name IS NULL OR product_name = '')
              AND source_product_id IS NOT NULL
        """)
        orphans = cur.fetchall()
    print(f"  {len(orphans):,} ítems sin product_name")

    # ── 3. Resolver nombres ───────────────────────────────────────────────────
    resolved   = []   # (item_id, product_name)
    unresolved = []

    for iid, src_pid in orphans:
        name = products_by_id.get(src_pid, "")
        if name:
            resolved.append((str(iid), name))
        else:
            unresolved.append((str(iid), src_pid))

    print(f"  Resueltos   : {len(resolved):,}")
    print(f"  Sin resolver: {len(unresolved):,}  (producto eliminado de catálogo)")

    # ── 4. Cargar orders de MongoDB para locality/barrio/direccion ────────────
    print("\nCargando orders para locality/neighborhood/address...")
    order_addr = {}   # source_id → {locality, neighborhood, address}
    for doc in db.orders.find({"envio.datos": {"$exists": True}}):
        datos = (doc.get("envio") or {}).get("datos") or {}
        loc   = datos.get("localidad")
        barrio = datos.get("barrio")
        dir_   = datos.get("direccion")
        if loc and loc == "None":
            loc = None
        city = datos.get("ciudad", "")
        if any([loc, barrio, dir_]):
            order_addr[str(doc["_id"])] = {
                "locality":     loc if city == "Bogotá" else None,
                "neighborhood": barrio or None,
                "address":      dir_ or None,
            }

    print(f"  {len(order_addr):,} órdenes con datos de dirección inline")

    client.close()

    # Cuántos fact_orders tienen source_id en legacy_mongo y necesitan locality/neigh/addr?
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, source_id
            FROM simora_v2.fact_orders
            WHERE source::text = 'legacy_mongo'
              AND (locality IS NULL OR neighborhood IS NULL OR address IS NULL)
        """)
        orders_to_enrich = cur.fetchall()
    print(f"  fact_orders legacy sin locality/neigh/addr completos: {len(orders_to_enrich):,}")

    addr_updates = []   # (order_id, locality, neighborhood, address)
    for oid, src_id in orders_to_enrich:
        ad = order_addr.get(src_id)
        if ad and any(ad.values()):
            addr_updates.append((str(oid), ad["locality"], ad["neighborhood"], ad["address"]))

    print(f"  Con datos resolvibles: {len(addr_updates):,}")

    # ── Preview ───────────────────────────────────────────────────────────────
    from collections import Counter
    name_dist = Counter(name for _, name in resolved)
    print(f"\n=== TOP 10 PRODUCT NAMES A RESTAURAR ===")
    for name, n in name_dist.most_common(10):
        print(f"  {name:<50} {n:>6,} líneas")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        conn.close()
        return {
            "dry_run": True,
            "product_name_resolved": len(resolved),
            "product_name_unresolved": len(unresolved),
            "order_addr_resolved": len(addr_updates),
        }

    # ── 5. Actualizar fact_order_items.product_name ───────────────────────────
    print(f"\nActualizando fact_order_items.product_name...")
    updated_items = 0
    BATCH = 500
    with conn.cursor() as cur:
        for i in range(0, len(resolved), BATCH):
            batch = resolved[i:i + BATCH]
            for iid, name in batch:
                cur.execute("""
                    UPDATE simora_v2.fact_order_items
                    SET product_name = %s
                    WHERE id = %s
                      AND (product_name IS NULL OR product_name = '')
                """, [name, iid])
                updated_items += cur.rowcount
        conn.commit()
    print(f"  Filas actualizadas: {updated_items:,}")

    # ── 6. Actualizar fact_orders locality/neighborhood/address ──────────────
    print(f"\nActualizando fact_orders locality/neighborhood/address desde envio.datos...")
    updated_orders = 0
    with conn.cursor() as cur:
        for i in range(0, len(addr_updates), BATCH):
            batch = addr_updates[i:i + BATCH]
            for oid, loc, neigh, addr in batch:
                cur.execute("""
                    UPDATE simora_v2.fact_orders
                    SET locality     = COALESCE(locality, %s),
                        neighborhood = COALESCE(neighborhood, %s),
                        address      = COALESCE(address, %s)
                    WHERE id = %s
                      AND (locality IS NULL OR neighborhood IS NULL OR address IS NULL)
                """, [loc, neigh, addr, oid])
                updated_orders += cur.rowcount
        conn.commit()
    print(f"  Filas actualizadas: {updated_orders:,}")

    # ── 7. Estado final ───────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL fact_order_items ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE product_name IS NOT NULL AND product_name != '') AS con_nombre,
              COUNT(*) FILTER (WHERE product_name IS NULL OR product_name = '') AS sin_nombre
            FROM simora_v2.fact_order_items
        """)
        r = cur.fetchone()
        pct = round(int(r[1]) / int(r[0]) * 100, 1)
        print(f"  total             : {int(r[0]):>8,}")
        print(f"  con product_name  : {int(r[1]):>8,}  ({pct}%)")
        print(f"  sin product_name  : {int(r[2]):>8,}")

    print("\n=== ESTADO FINAL fact_orders (address detail) ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE locality IS NOT NULL) AS con_locality,
              COUNT(*) FILTER (WHERE neighborhood IS NOT NULL) AS con_neighborhood,
              COUNT(*) FILTER (WHERE address IS NOT NULL) AS con_address
            FROM simora_v2.fact_orders
        """)
        r = cur.fetchone()
        t = int(r[0])
        print(f"  con locality      : {int(r[1]):>8,}  ({round(int(r[1])/t*100,1)}%)")
        print(f"  con neighborhood  : {int(r[2]):>8,}  ({round(int(r[2])/t*100,1)}%)")
        print(f"  con address       : {int(r[3]):>8,}  ({round(int(r[3])/t*100,1)}%)")

    # ── 8. Bitácora ───────────────────────────────────────────────────────────
    try:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO audit.log_entries
                  (slug, category, severity, title, body, tags,
                   source, affected_count, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, [
                "simora",
                "data_quality",
                "high",
                "Fix 21: product_name y dirección de entrega restaurados desde MongoDB",
                (
                    f"product_name restaurado en {updated_items:,} fact_order_items. "
                    f"Fuente: MongoDB products collection via source_product_id. "
                    f"Sin resolver (producto eliminado): {len(unresolved):,}. "
                    f"fact_orders locality/neighborhood/address actualizado en {updated_orders:,} pedidos "
                    f"desde orders.envio.datos (fuente inline más precisa que dispatch_log). "
                    f"El ETL original ignoraba: products lookup para product_name, "
                    f"y envio.datos.localidad/barrio/direccion."
                ),
                ["fix", "fact_order_items", "product_name", "direccion", "mongodb"],
                "21_order_item_product_name.py",
                updated_items + updated_orders,
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "product_name_updated": updated_items,
        "product_name_unresolved": len(unresolved),
        "order_addr_updated": updated_orders,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
