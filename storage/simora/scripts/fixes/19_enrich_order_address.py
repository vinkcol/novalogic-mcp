"""
Fix 19: Enriquecer dirección completa en fact_orders y dim_customers
====================================================================
fact_orders tiene city vacío en 2,775 pedidos y carece de columnas
locality, neighborhood, address. Toda orden tiene datos de entrega
almacenados en fact_guides y fact_dispatch_log.

Pasos:
  1. Agregar columnas: locality, neighborhood, address a fact_orders.
  2. Poblar city + department en fact_orders desde:
       A. fact_guides.destination_city/department  (via order_id)    → 2,754 pedidos
       B. fact_dispatch_log.city/department         (via guide_number) → fallback
  3. Poblar locality, neighborhood, address desde fact_dispatch_log
     (via guide_number).
  4. Re-inferir dim_customers.city para los clientes que aún no tienen
     ciudad (la actualización de fact_orders crea nuevas señales).

Uso:
  python 19_enrich_order_address.py --dry-run
  python 19_enrich_order_address.py
"""

import sys
import json
import argparse
import unicodedata
from pathlib import Path
from collections import Counter, defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def norm(s: str) -> str:
    s = str(s or "").lower().strip()
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")


def ensure_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.fact_orders
              ADD COLUMN IF NOT EXISTS locality     VARCHAR(100),
              ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(100),
              ADD COLUMN IF NOT EXISTS address      TEXT
        """)
    conn.commit()


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_columns(conn)

    # ── 1. Cargar pedidos sin ciudad ─────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, guide_number, source_id
            FROM simora_v2.fact_orders
            WHERE city IS NULL OR city = ''
        """)
        no_city = cur.fetchall()
    print(f"Pedidos sin ciudad: {len(no_city):,}")

    # ── 2. Fuente A: fact_guides por order_id ────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT fg.order_id,
                   fg.destination_city,
                   fg.destination_department
            FROM simora_v2.fact_guides fg
            WHERE fg.destination_city IS NOT NULL AND fg.destination_city != ''
        """)
        guides_by_order = {str(r[0]): (r[1], r[2]) for r in cur.fetchall()}
    print(f"Registros en fact_guides con ciudad: {len(guides_by_order):,}")

    # ── 3. Fuente B: fact_dispatch_log por guide_number ──────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT guide_number, city, department, locality, neighborhood, address
            FROM simora_v2.fact_dispatch_log
            WHERE guide_number IS NOT NULL
        """)
        dispatch_by_guide = {}
        for r in cur.fetchall():
            guide = r[0]
            if guide and guide not in dispatch_by_guide:
                dispatch_by_guide[guide] = {
                    "city": r[1], "department": r[2],
                    "locality": r[3] if r[3] and r[3] != 'n/a' else None,
                    "neighborhood": r[4],
                    "address": r[5],
                }
    print(f"Registros en fact_dispatch_log: {len(dispatch_by_guide):,}")

    # ── 4. Resolver dirección por pedido ─────────────────────────────────────
    city_updates  = []   # (order_id, city, department)
    local_updates = []   # (order_id, locality, neighborhood, address)
    unresolved    = []

    for oid, guide, source_id in no_city:
        city, dept = None, None
        loc, neigh, addr = None, None, None

        # Fuente A
        if str(oid) in guides_by_order:
            city, dept = guides_by_order[str(oid)]

        # Fuente B (fallback para city, primaria para locality/neigh/addr)
        dl = dispatch_by_guide.get(guide) if guide else None
        if dl:
            if not city and dl["city"]:
                city = dl["city"]
            if not dept and dl["department"]:
                dept = dl["department"]
            loc   = dl["locality"]
            neigh = dl["neighborhood"]
            addr  = dl["address"]

        if city:
            city_updates.append((str(oid), city, dept))
        else:
            unresolved.append((str(oid), guide, source_id))

        if loc or neigh or addr:
            local_updates.append((str(oid), loc, neigh, addr))

    print(f"\nPedidos con ciudad resuelta   : {len(city_updates):,}")
    print(f"Pedidos con locality/neigh/addr: {len(local_updates):,}")
    print(f"Sin resolución posible         : {len(unresolved):,}")

    if unresolved:
        print(f"\n  [Sin resolver]:")
        for oid, guide, src in unresolved[:10]:
            print(f"    order={oid[:8]}... guide={guide}  source_id={src}")

    # Preview distribución de ciudades recuperadas
    city_dist = Counter(city for _, city, _ in city_updates)
    print(f"\n=== TOP 10 CIUDADES RECUPERADAS ===")
    for city, n in city_dist.most_common(10):
        print(f"  {city:<30} {n:>6,}")

    # ── 5. También enriquecer locality/neigh/addr para pedidos QUE YA TIENEN ciudad ──
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, guide_number
            FROM simora_v2.fact_orders
            WHERE city IS NOT NULL AND city != ''
              AND (locality IS NULL OR neighborhood IS NULL OR address IS NULL)
              AND guide_number IS NOT NULL
        """)
        with_city_no_detail = cur.fetchall()
    print(f"\nPedidos con ciudad pero sin detalle (locality/neigh/addr): {len(with_city_no_detail):,}")

    for oid, guide in with_city_no_detail:
        dl = dispatch_by_guide.get(guide)
        if dl and (dl["locality"] or dl["neighborhood"] or dl["address"]):
            local_updates.append((str(oid), dl["locality"], dl["neighborhood"], dl["address"]))

    print(f"Total locality/neigh/addr a actualizar: {len(local_updates):,}")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")

        # Proyectar impacto en dim_customers
        # Clientes sin ciudad que tienen pedidos resolvibles
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(DISTINCT fo.customer_id)
                FROM simora_v2.fact_orders fo
                WHERE (fo.city IS NULL OR fo.city = '')
                  AND fo.customer_id IS NOT NULL
                  AND fo.customer_id IN (
                    SELECT id FROM simora_v2.dim_customers
                    WHERE city IS NULL OR city = ''
                  )
                  AND fo.id = ANY(%s::uuid[])
            """, [[oid for oid, _, _ in city_updates]])
            extra_customers = cur.fetchone()[0]
        print(f"\n  Clientes adicionales que obtendrían ciudad: {extra_customers:,}")

        conn.close()
        return {
            "dry_run": True,
            "city_resolved": len(city_updates),
            "unresolved": len(unresolved),
            "extra_customers": extra_customers,
        }

    # ── 6. Actualizar fact_orders.city + department ──────────────────────────
    print(f"\nActualizando fact_orders city/department...")
    updated_city = 0
    BATCH = 500
    with conn.cursor() as cur:
        for i in range(0, len(city_updates), BATCH):
            batch = city_updates[i:i + BATCH]
            for oid, city, dept in batch:
                cur.execute("""
                    UPDATE simora_v2.fact_orders
                    SET city       = %s,
                        department = COALESCE(department, %s)
                    WHERE id = %s
                      AND (city IS NULL OR city = '')
                """, [city, dept, oid])
                updated_city += cur.rowcount
        conn.commit()
    print(f"  city actualizado: {updated_city:,}")

    # ── 7. Actualizar locality/neighborhood/address ──────────────────────────
    print(f"\nActualizando locality/neighborhood/address...")
    updated_local = 0
    # Deduplicar (un order_id puede aparecer dos veces en local_updates)
    local_dedup = {}
    for oid, loc, neigh, addr in local_updates:
        if oid not in local_dedup:
            local_dedup[oid] = (loc, neigh, addr)

    with conn.cursor() as cur:
        items = list(local_dedup.items())
        for i in range(0, len(items), BATCH):
            batch = items[i:i + BATCH]
            for oid, (loc, neigh, addr) in batch:
                cur.execute("""
                    UPDATE simora_v2.fact_orders
                    SET locality     = COALESCE(locality, %s),
                        neighborhood = COALESCE(neighborhood, %s),
                        address      = COALESCE(address, %s)
                    WHERE id = %s
                      AND (locality IS NULL OR neighborhood IS NULL OR address IS NULL)
                """, [loc, neigh, addr, oid])
                updated_local += cur.rowcount
        conn.commit()
    print(f"  locality/neighborhood/address actualizado: {updated_local:,}")

    # ── 8. Re-inferir dim_customers.city ─────────────────────────────────────
    print(f"\nRe-infiriendo dim_customers.city para clientes sin ciudad...")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT fo.customer_id, fo.city, fo.department, fo.order_date
            FROM simora_v2.fact_orders fo
            WHERE fo.customer_id IS NOT NULL
              AND fo.city IS NOT NULL AND fo.city != ''
              AND fo.customer_id IN (
                SELECT id FROM simora_v2.dim_customers
                WHERE city IS NULL OR city = ''
              )
            ORDER BY fo.order_date ASC
        """)
        rows = cur.fetchall()

    by_customer: dict = defaultdict(list)
    for cid, city, dept, odate in rows:
        by_customer[str(cid)].append((city, dept, odate))

    new_resolved = {}
    for cid, entries in by_customer.items():
        city_count = Counter(city for city, _, _ in entries)
        max_freq = max(city_count.values())
        top_cities = [c for c, n in city_count.items() if n == max_freq]
        best_city = top_cities[0] if len(top_cities) == 1 else \
            max(entries, key=lambda x: x[2] or "")[0]
        best_dept = max(
            (e for e in entries if e[0] == best_city),
            key=lambda x: x[2] or ""
        )[1]
        new_resolved[cid] = (best_city, best_dept)

    print(f"  Nuevos clientes con ciudad inferida: {len(new_resolved):,}")

    updated_customers = 0
    with conn.cursor() as cur:
        items = list(new_resolved.items())
        for i in range(0, len(items), BATCH):
            batch = items[i:i + BATCH]
            for cid, (city, dept) in batch:
                cur.execute("""
                    UPDATE simora_v2.dim_customers
                    SET city       = %s,
                        department = COALESCE(department, %s)
                    WHERE id = %s
                      AND (city IS NULL OR city = '')
                """, [city, dept, cid])
                updated_customers += cur.rowcount
        conn.commit()
    print(f"  dim_customers actualizados: {updated_customers:,}")

    # ── 9. Estado final ───────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL fact_orders ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE city IS NOT NULL AND city != '') AS con_city,
              COUNT(*) FILTER (WHERE locality IS NOT NULL) AS con_locality,
              COUNT(*) FILTER (WHERE neighborhood IS NOT NULL) AS con_neighborhood,
              COUNT(*) FILTER (WHERE address IS NOT NULL) AS con_address
            FROM simora_v2.fact_orders
        """)
        r = cur.fetchone()
        print(f"  total          : {int(r[0]):>8,}")
        print(f"  con city       : {int(r[1]):>8,}  ({round(int(r[1])/int(r[0])*100,1)}%)")
        print(f"  con locality   : {int(r[2]):>8,}  ({round(int(r[2])/int(r[0])*100,1)}%)")
        print(f"  con neighborhood: {int(r[3]):>7,}  ({round(int(r[3])/int(r[0])*100,1)}%)")
        print(f"  con address    : {int(r[4]):>8,}  ({round(int(r[4])/int(r[0])*100,1)}%)")

    print("\n=== ESTADO FINAL dim_customers ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE city IS NOT NULL AND city != '') AS con_city,
              COUNT(*) FILTER (WHERE city IS NULL OR city = '') AS sin_city,
              COUNT(DISTINCT city) FILTER (WHERE city IS NOT NULL) AS ciudades
            FROM simora_v2.dim_customers
        """)
        r = cur.fetchone()
        print(f"  total          : {int(r[0]):>8,}")
        print(f"  con city       : {int(r[1]):>8,}  ({round(int(r[1])/int(r[0])*100,1)}%)")
        print(f"  sin city       : {int(r[2]):>8,}")
        print(f"  ciudades únicas: {int(r[3]):>8,}")

    # ── 10. Bitácora ─────────────────────────────────────────────────────────
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
                "Fix 19: city/department/locality/neighborhood/address enriquecidos en fact_orders y dim_customers",
                (
                    f"fact_orders: city actualizado en {updated_city:,} pedidos (fuentes: fact_guides orden_id + "
                    f"fact_dispatch_log guide_number). locality/neigh/addr en {updated_local:,} pedidos. "
                    f"Columnas nuevas: locality, neighborhood, address. "
                    f"dim_customers: {updated_customers:,} clientes adicionales con ciudad. "
                    f"Sin resolver: {len(unresolved):,} pedidos."
                ),
                ["fix", "direccion", "ciudad", "localidad", "fact_orders", "dim_customers"],
                "19_enrich_order_address.py",
                updated_city + updated_customers,
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "city_resolved": updated_city,
        "locality_resolved": updated_local,
        "customers_updated": updated_customers,
        "unresolved": len(unresolved),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
