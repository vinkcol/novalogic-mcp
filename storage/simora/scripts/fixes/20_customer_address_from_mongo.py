"""
Fix 20: Ciudad/dirección completa en dim_customers desde MongoDB addressitems
=============================================================================
El ETL original ignoró la relación customers.addressList → addressitems.
Cada customer en MongoDB tiene una lista de ObjectId que apuntan a la
colección 'addressitems', la cual contiene:
  ciudad, departamento, localidad, barrio, direccion

Estrategia:
  1. Cargar todos los addressitems de MongoDB en memoria.
  2. Para cada customer en MongoDB, seguir su addressList y tomar la
     dirección MÁS RECIENTE (último elemento = más nuevo).
  3. Para Bogotá, también poblar locality (= localidad) y neighborhood (= barrio).
  4. Actualizar dim_customers con city, department, address, y los
     campos locality/neighborhood si es que se agregan.
  5. También actualizar fact_orders con locality/neighborhood para
     pedidos en Bogotá donde falta esa info (via customer → addressitem).

Nota: locality solo aplica a Bogotá (localidades bogotanas).

Uso:
  python 20_customer_address_from_mongo.py --dry-run
  python 20_customer_address_from_mongo.py
"""

import sys
import json
import argparse
from pathlib import Path
from bson import ObjectId
from pymongo import MongoClient
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

MONGO_URI = "mongodb://magibell:magibell2026@localhost:27019/magibell_legacy?authSource=admin"


def ensure_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.dim_customers
              ADD COLUMN IF NOT EXISTS locality     VARCHAR(100),
              ADD COLUMN IF NOT EXISTS neighborhood VARCHAR(100)
        """)
    conn.commit()


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_columns(conn)

    # ── 1. Cargar addressitems de MongoDB ────────────────────────────────────
    print("Conectando a MongoDB...")
    client = MongoClient(MONGO_URI)
    db = client["magibell_legacy"]

    print("Cargando addressitems...")
    addr_by_id = {}
    for doc in db.addressitems.find({}):
        addr_by_id[str(doc["_id"])] = {
            "city":         doc.get("ciudad") or "",
            "department":   doc.get("departamento") or "",
            "locality":     doc.get("localidad") if doc.get("localidad") not in (None, "None", "") else None,
            "neighborhood": doc.get("barrio") or None,
            "address":      doc.get("direccion") or None,
        }
    print(f"  {len(addr_by_id):,} addressitems cargados")

    # ── 2. Para cada customer en Mongo, resolver su última dirección ─────────
    print("Cargando customers con addressList...")
    mongo_customer_addr = {}   # mongo_id → addr dict
    no_addr = 0

    for doc in db.customers.find({"addressList": {"$exists": True}}):
        mongo_id = str(doc["_id"])
        addr_list = doc.get("addressList") or []

        # addr_list puede ser lista de ObjectId o lista de strings
        resolved_addrs = []
        for item in addr_list:
            item_str = str(item)
            if item_str in addr_by_id:
                resolved_addrs.append(addr_by_id[item_str])

        if resolved_addrs:
            # Usar la última dirección (más reciente)
            mongo_customer_addr[mongo_id] = resolved_addrs[-1]
        else:
            no_addr += 1

    print(f"  {len(mongo_customer_addr):,} customers con dirección resuelta")
    print(f"  {no_addr:,} customers sin addressitems resolvibles")
    client.close()

    # ── 3. Cargar dim_customers sin ciudad ───────────────────────────────────
    print("\nCargando dim_customers sin ciudad completa...")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, source_id, city, department, address, locality, neighborhood
            FROM simora_v2.dim_customers
            WHERE source::text = 'legacy_mongo'
        """)
        customers = cur.fetchall()
    print(f"  {len(customers):,} clientes legacy_mongo")

    # ── 4. Cruzar ────────────────────────────────────────────────────────────
    to_update = []
    for cid, source_id, cur_city, cur_dept, cur_addr, cur_loc, cur_neigh in customers:
        addr = mongo_customer_addr.get(source_id)
        if not addr:
            continue

        # Solo actualizar si hay mejora real
        new_city  = addr["city"] or cur_city
        new_dept  = addr["department"] or cur_dept
        new_addr  = addr["address"] or cur_addr
        new_loc   = addr["locality"] if addr["city"] == "Bogotá" else None
        new_neigh = addr["neighborhood"] or cur_neigh

        # Bogotá: locality es la localidad administrativa (solo aplica a Bogotá)
        needs_update = (
            (new_city and new_city != cur_city) or
            (new_dept and new_dept != cur_dept) or
            (new_addr and new_addr != cur_addr) or
            (new_loc and new_loc != cur_loc) or
            (new_neigh and new_neigh != cur_neigh)
        )
        if needs_update:
            to_update.append((str(cid), new_city, new_dept, new_addr, new_loc, new_neigh))

    print(f"\n  Clientes a actualizar: {len(to_update):,}")

    # Estadísticas del enriquecimiento
    from collections import Counter
    city_dist = Counter(city for _, city, *_ in to_update if city)
    print(f"\n=== TOP 10 CIUDADES EN ADDRESSITEMS ===")
    for city, n in city_dist.most_common(10):
        print(f"  {city:<30} {n:>7,}")

    # Bogotá con localidad
    bogota_con_loc = sum(1 for _, city, dept, addr, loc, neigh in to_update
                         if city == "Bogotá" and loc)
    bogota_sin_loc = sum(1 for _, city, dept, addr, loc, neigh in to_update
                         if city == "Bogotá" and not loc)
    print(f"\n  Bogotá con localidad    : {bogota_con_loc:,}")
    print(f"  Bogotá sin localidad    : {bogota_sin_loc:,}")
    print(f"  Fuera de Bogotá         : {len(to_update) - bogota_con_loc - bogota_sin_loc:,}")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")

        # Proyectar mejora en cobertura
        with conn.cursor() as cur:
            cur.execute("""
                SELECT COUNT(*) FROM simora_v2.dim_customers
                WHERE city IS NULL OR city = ''
            """)
            sin_ciudad_actual = cur.fetchone()[0]

        new_sin_ciudad = sin_ciudad_actual - sum(
            1 for _, city, *_ in to_update if city
        )
        print(f"\n  dim_customers sin ciudad actual : {sin_ciudad_actual:,}")
        print(f"  dim_customers sin ciudad después: ~{max(0, new_sin_ciudad):,}")
        conn.close()
        return {
            "dry_run": True,
            "to_update": len(to_update),
            "top_city": city_dist.most_common(1)[0][0] if city_dist else None,
        }

    # ── 5. Actualizar dim_customers ──────────────────────────────────────────
    print("\nActualizando dim_customers...")
    updated = 0
    BATCH = 500

    with conn.cursor() as cur:
        for i in range(0, len(to_update), BATCH):
            batch = to_update[i:i + BATCH]
            for cid, city, dept, addr, loc, neigh in batch:
                cur.execute("""
                    UPDATE simora_v2.dim_customers
                    SET city         = COALESCE(NULLIF(%s,''), city),
                        department   = COALESCE(NULLIF(%s,''), department),
                        address      = COALESCE(NULLIF(%s,''), address),
                        locality     = COALESCE(NULLIF(%s,''), locality),
                        neighborhood = COALESCE(NULLIF(%s,''), neighborhood)
                    WHERE id = %s
                """, [city, dept, addr, loc, neigh, cid])
                updated += cur.rowcount
        conn.commit()
    print(f"  Filas actualizadas: {updated:,}")

    # ── 6. Estado final ───────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL dim_customers ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE city IS NOT NULL AND city != '') AS con_city,
              COUNT(*) FILTER (WHERE city IS NULL OR city = '') AS sin_city,
              COUNT(*) FILTER (WHERE locality IS NOT NULL) AS con_locality,
              COUNT(*) FILTER (WHERE neighborhood IS NOT NULL) AS con_neighborhood,
              COUNT(*) FILTER (WHERE address IS NOT NULL) AS con_address,
              COUNT(DISTINCT city) FILTER (WHERE city IS NOT NULL) AS ciudades_unicas
            FROM simora_v2.dim_customers
        """)
        r = cur.fetchone()
        total = int(r[0])
        print(f"  total              : {total:>8,}")
        print(f"  con city           : {int(r[1]):>8,}  ({round(int(r[1])/total*100,1)}%)")
        print(f"  sin city           : {int(r[2]):>8,}")
        print(f"  con locality       : {int(r[3]):>8,}  (solo Bogotá)")
        print(f"  con neighborhood   : {int(r[4]):>8,}")
        print(f"  con address        : {int(r[5]):>8,}")
        print(f"  ciudades únicas    : {int(r[6]):>8,}")

    print("\n=== TOP 15 CIUDADES ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT city, COUNT(*) n,
                   ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(), 1) pct
            FROM simora_v2.dim_customers
            WHERE city IS NOT NULL AND city != ''
            GROUP BY city ORDER BY n DESC LIMIT 15
        """)
        print(f"  {'Ciudad':<30} {'clientes':>9}  {'%':>6}")
        print("  " + "-" * 48)
        for r in cur.fetchall():
            print(f"  {str(r[0]):<30} {int(r[1]):>9,}  {float(r[2]):>5.1f}%")

    print("\n=== TOP 10 LOCALIDADES (Bogotá) ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT locality, COUNT(*) n
            FROM simora_v2.dim_customers
            WHERE city = 'Bogotá' AND locality IS NOT NULL
            GROUP BY locality ORDER BY n DESC LIMIT 10
        """)
        for r in cur.fetchall():
            print(f"  {str(r[0]):<30} {int(r[1]):>7,}")

    # ── 7. Bitácora ───────────────────────────────────────────────────────────
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
                "Fix 20: ciudad/direccion completa en dim_customers desde MongoDB addressitems",
                (
                    f"Se resolvió la relación customers.addressList → addressitems en MongoDB. "
                    f"{updated:,} clientes actualizados con city, department, address, locality (Bogotá), neighborhood. "
                    f"addressitems total: {len(addr_by_id):,}. "
                    f"Top ciudad: {city_dist.most_common(1)[0][0] if city_dist else '?'}. "
                    f"El ETL original (01_legacy_mongo_to_simora_v2.py) ignoraba addressList (solo guardaba ObjectIds). "
                    f"Columnas nuevas en dim_customers: locality, neighborhood."
                ),
                ["fix", "clientes", "ciudad", "mongodb", "addressitems", "direccion"],
                "20_customer_address_from_mongo.py",
                updated,
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "mongo_resolved": len(mongo_customer_addr),
        "updated": updated,
        "top_cities": dict(city_dist.most_common(5)),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
