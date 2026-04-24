"""
Fix 22: Ciudad/dirección de clientes novalogic desde PostgreSQL de Novalogic
=============================================================================
1,485 clientes en dim_customers (source='novalogic') no tienen city.
Estos registros provienen de la base de datos de Novalogic (PostgreSQL,
schema customers) — no de MongoDB — por lo que los fixes anteriores
(20_customer_address_from_mongo.py) no los cubren.

Estrategia:
  1. Conectar directamente al PostgreSQL de Novalogic (puerto 5436).
  2. Consultar customers.customer_addresses con LEFT JOIN LATERAL
     para obtener la mejor dirección de cada cliente.
  3. Cruzar por source_id (= UUID del cliente en Novalogic) con dim_customers.
  4. Actualizar city, department, locality (Bogotá), neighborhood, address.

Uso:
  python 22_novalogic_customer_city.py --dry-run
  python 22_novalogic_customer_city.py
"""

import sys
import json
import argparse
from pathlib import Path

import psycopg2
import psycopg2.extras

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

# ── Conexión al PostgreSQL principal de Novalogic ──────────────────────────────
NOVALOGIC_DSN = {
    "host":     "localhost",
    "port":     5436,
    "dbname":   "novalogic_erp_n",
    "user":     "novalogic",
    "password": "novalogic2024",
}


def get_novalogic_conn():
    return psycopg2.connect(**NOVALOGIC_DSN)


def run(dry_run: bool):
    # ── 1. Cargar dim_customers sin ciudad (source='novalogic') ───────────────
    print("Conectando a simora_v2...")
    simora = simora_db.get_conn()

    print("Cargando dim_customers sin city (source='novalogic')...")
    with simora.cursor() as cur:
        cur.execute("""
            SELECT id, source_id
            FROM simora_v2.dim_customers
            WHERE source::text = 'novalogic'
              AND (city IS NULL OR city = '')
        """)
        orphans = cur.fetchall()
    print(f"  {len(orphans):,} clientes sin city")

    if not orphans:
        print("  Nada que hacer.")
        simora.close()
        return {"updated": 0}

    orphan_ids = {str(row[1]): str(row[0]) for row in orphans}  # source_id → dim_id

    # ── 2. Consultar customer_addresses en Novalogic ──────────────────────────
    print("\nConectando a Novalogic PostgreSQL (puerto 5436)...")
    nova = get_novalogic_conn()

    print("Consultando customers.customer_addresses...")
    with nova.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute("""
            SELECT
              c.id::text,
              a.city,
              a.state         AS department,
              a.locality,
              a.neighborhood,
              a.street        AS address
            FROM customers.customers c
            LEFT JOIN LATERAL (
              SELECT city, state, locality, neighborhood, street
              FROM customers.customer_addresses ca
              WHERE ca.customer_id = c.id
                AND ca.is_deleted = false
              ORDER BY ca.is_default DESC, ca.created_at DESC
              LIMIT 1
            ) a ON true
            WHERE c.is_deleted = false
              AND c.id = ANY(%s::uuid[])
        """, [list(orphan_ids.keys())])
        rows = cur.fetchall()
    print(f"  {len(rows):,} clientes consultados en Novalogic")

    # Construir mapa inicial desde customer_addresses
    addr_by_customer: dict[str, dict] = {}
    for row in rows:
        if row.get("city"):
            addr_by_customer[str(row["id"])] = dict(row)

    # ── Fallback: shipping_info jsonb en sales.sales ──────────────────────────
    still_missing = [cid for cid in orphan_ids if cid not in addr_by_customer]
    if still_missing:
        print(f"\n  {len(still_missing):,} clientes aún sin city — buscando en sales.sales.shipping_info...")
        with nova.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute("""
                SELECT DISTINCT ON (customer_id)
                  customer_id::text,
                  shipping_info->>'city'         AS city,
                  shipping_info->>'department'   AS department,
                  shipping_info->>'locality'     AS locality,
                  shipping_info->>'neighborhood' AS neighborhood,
                  shipping_info->>'address'      AS address
                FROM sales.sales
                WHERE customer_id = ANY(%s::uuid[])
                  AND is_deleted = false
                  AND shipping_info->>'city' IS NOT NULL
                  AND shipping_info->>'city' != ''
                ORDER BY customer_id, created_at DESC
            """, [still_missing])
            sales_rows = cur.fetchall()
        print(f"  Encontrados via shipping_info: {len(sales_rows):,}")
        for row in sales_rows:
            cid = str(row["customer_id"])
            if row.get("city"):
                addr_by_customer[cid] = {
                    "id":           cid,
                    "city":         row["city"],
                    "department":   row["department"],
                    "locality":     row["locality"],
                    "neighborhood": row["neighborhood"],
                    "address":      row["address"],
                }

    nova.close()

    # ── 3. Cruzar ─────────────────────────────────────────────────────────────
    to_update = []
    for customer_id, row in addr_by_customer.items():
        if customer_id not in orphan_ids:
            continue
        city  = (row.get("city") or "").strip() or None
        dept  = (row.get("department") or "").strip() or None
        loc   = (row.get("locality") or "").strip() or None
        neigh = (row.get("neighborhood") or "").strip() or None
        street= (row.get("address") or "").strip() or None
        if not city:
            continue
        # locality solo aplica para Bogotá
        if city != "Bogotá":
            loc = None
        to_update.append((
            orphan_ids[customer_id],
            city, dept, loc, neigh, street,
        ))

    print(f"  Resolvibles   : {len(to_update):,}")
    print(f"  Sin dirección : {len(orphans) - len(to_update):,}  (cliente existe pero sin address en Novalogic)")

    if not to_update:
        print("\n  No hay datos para actualizar.")
        simora.close()
        return {"updated": 0}

    from collections import Counter
    city_dist = Counter(city for _, city, *_ in to_update if city)
    print(f"\n=== TOP 10 CIUDADES ===")
    for city, n in city_dist.most_common(10):
        print(f"  {city:<30} {n:>6,}")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        simora.close()
        return {"dry_run": True, "to_update": len(to_update)}

    # ── 4. Actualizar dim_customers ──────────────────────────────────────────
    print(f"\nActualizando {len(to_update):,} clientes en dim_customers...")
    updated = 0
    BATCH = 500
    with simora.cursor() as cur:
        for i in range(0, len(to_update), BATCH):
            batch = to_update[i:i + BATCH]
            for dim_id, city, dept, loc, neigh, street in batch:
                cur.execute("""
                    UPDATE simora_v2.dim_customers
                    SET city         = COALESCE(NULLIF(%s,''), city),
                        department   = COALESCE(NULLIF(%s,''), department),
                        locality     = COALESCE(NULLIF(%s,''), locality),
                        neighborhood = COALESCE(NULLIF(%s,''), neighborhood),
                        address      = COALESCE(NULLIF(%s,''), address)
                    WHERE id = %s
                      AND (city IS NULL OR city = '')
                """, [city, dept, loc, neigh, street, dim_id])
                updated += cur.rowcount
        simora.commit()
    print(f"  Filas actualizadas: {updated:,}")

    # ── 5. Estado final ───────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL dim_customers (novalogic) ===")
    with simora.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE city IS NOT NULL AND city != '') AS con_city,
              COUNT(*) FILTER (WHERE city IS NULL OR city = '') AS sin_city
            FROM simora_v2.dim_customers
            WHERE source::text = 'novalogic'
        """)
        r = cur.fetchone()
        t = int(r[0])
        print(f"  total       : {t:>8,}")
        print(f"  con city    : {int(r[1]):>8,}  ({round(int(r[1])/t*100,1)}%)")
        print(f"  sin city    : {int(r[2]):>8,}")

    # ── 6. Bitácora ───────────────────────────────────────────────────────────
    try:
        with simora.cursor() as cur:
            cur.execute("""
                INSERT INTO audit.log_entries
                  (slug, category, severity, title, body, tags,
                   source, affected_count, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """, [
                "simora",
                "data_quality",
                "medium",
                "Fix 22: ciudad/dirección de clientes novalogic desde PostgreSQL directo",
                (
                    f"{updated:,} clientes novalogic actualizados con city/department/locality/neighborhood. "
                    f"Fuente: customers.customer_addresses en novalogic_erp_n (puerto 5436) via LEFT JOIN LATERAL. "
                    f"Sin resolver (sin dirección): {len(orphans) - len(to_update):,}. "
                    f"Top ciudad: {city_dist.most_common(1)[0][0] if city_dist else '?'}."
                ),
                ["fix", "clientes", "ciudad", "novalogic", "postgresql"],
                "22_novalogic_customer_city.py",
                updated,
                "resolved",
            ])
        simora.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    simora.close()
    return {
        "novalogic_queried": len(rows),
        "resolvable": len(to_update),
        "updated": updated,
        "top_city": city_dist.most_common(1)[0][0] if city_dist else None,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
