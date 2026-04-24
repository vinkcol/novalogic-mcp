"""
Fix 04: Cruce y deduplicación de dim_employees
===============================================
Situación encontrada:
  - ETL 01 (legacy_mongo) y ETL 02 (novalogic) crearon filas SEPARADAS
    para la misma persona física. Ejemplo:
      "Lina María Beltrán Beltrán" (legacy_mongo_id)  → sin novalogic_id
      "Lina Maria Beltrán Beltrán" (novalogic_id)     → sin legacy_mongo_id

  - 4 pares de duplicados identificados por nombre similar:
      Lina María / Lina Maria
      Yuri Andrea / Yury Andrea
      Paula Valentina Ariza Polanía (×2)
      Camila Rincón ↔ Laura Camila Rincón Urrego (posible)

Estrategia:
  1. Para duplicados confirmados: MERGE — la fila novalogic absorbe
     el legacy_mongo_id de la fila legacy. Luego DELETE la fila legacy.
  2. Actualizar fact_orders y fact_guides para apuntar al id canónico.
  3. Backfill dim_employee_id en fact_orders y fact_guides usando
     la relación seller_id (dim_sellers ↔ dim_employees).

Uso:
  python 04_link_employees.py --dry-run
  python 04_link_employees.py
"""

import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

# ── Pares de merge confirmados ────────────────────────────────────────────────
# (legacy_canonical_name, novalogic_canonical_name)
# La fila con novalogic_id es la canónica; absorbe el legacy_mongo_id.
MERGE_PAIRS = [
    ("Lina María Beltrán Beltrán",      "Lina Maria Beltrán Beltrán"),
    ("Yuri Andrea Romero Villa",         "Yury Andrea Romero Villa"),
    ("Paula Valentina Ariza Polanía",    "Paula Valentina Ariza Polanía"),  # mismo nombre, distinta fuente
]

# ── Cruce seller → employee (fact_orders usa seller_id de dim_sellers) ────────
# dim_sellers.source_id (MongoDB _id) se puede correlacionar con
# dim_employees.legacy_mongo_id para el período legacy.
# Para Novalogic: la tabla sales tiene seller_id = employees.id directamente.
SELLER_TO_EMPLOYEE_SQL = """
UPDATE simora_v2.fact_orders fo
SET dim_employee_id = de.id
FROM simora_v2.dim_sellers ds
JOIN simora_v2.dim_employees de
  ON de.legacy_mongo_id = ds.source_id   -- legacy período
WHERE fo.seller_id = ds.id
  AND fo.source = 'legacy_mongo'
  AND fo.dim_employee_id IS NULL
  AND de.novalogic_id IS NOT NULL   -- solo merged o confirmados
"""

# Para guías: igual, a través de fact_orders
GUIDE_BACKFILL_SQL = """
UPDATE simora_v2.fact_guides fg
SET dim_employee_id = fo.dim_employee_id
FROM simora_v2.fact_orders fo
WHERE fg.order_id = fo.id
  AND fg.dim_employee_id IS NULL
  AND fo.dim_employee_id IS NOT NULL
"""

# Para Novalogic: seller_id en fact_orders es el uuid del empleado en ERP
NOVALOGIC_BACKFILL_SQL = """
UPDATE simora_v2.fact_orders fo
SET dim_employee_id = de.id
FROM simora_v2.dim_employees de
WHERE fo.source = 'novalogic'
  AND de.novalogic_id::text = (
      SELECT seller_id::text FROM simora_v2.fact_orders fo2
      WHERE fo2.id = fo.id
  )
  AND fo.dim_employee_id IS NULL
"""


def run(dry_run: bool):
    conn = simora_db.get_conn()

    # ── 1. Resolver duplicados exactos por nombre idéntico ──────────────────
    # Primero los pares donde el nombre es EXACTAMENTE igual (Paula Valentina)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT canonical_name,
                   COUNT(*) AS n,
                   array_agg(id::text ORDER BY novalogic_id NULLS LAST) AS ids,
                   array_agg(legacy_mongo_id ORDER BY novalogic_id NULLS LAST) AS legacies,
                   array_agg(novalogic_id::text ORDER BY novalogic_id NULLS LAST) AS novas,
                   array_agg(sources::text ORDER BY novalogic_id NULLS LAST) AS srcs
            FROM simora_v2.dim_employees
            GROUP BY canonical_name
            HAVING COUNT(*) > 1
        """)
        exact_dups = cur.fetchall()

    print(f"Duplicados de nombre exacto: {len(exact_dups)}")
    for row in exact_dups:
        print(f"  {row[0]!r}: {row[1]} filas -> ids={row[2]}")

    # ── 2. Resolver pares por similaridad (merge definido arriba) ───────────
    merge_ops = []

    with conn.cursor() as cur:
        for legacy_name, nova_name in MERGE_PAIRS:
            cur.execute("""
                SELECT id, canonical_name, legacy_mongo_id, novalogic_id, sources
                FROM simora_v2.dim_employees
                WHERE canonical_name IN (%s, %s)
            """, [legacy_name, nova_name])
            rows = {r[1]: r for r in cur.fetchall()}

            legacy_row = rows.get(legacy_name)
            nova_row   = rows.get(nova_name)

            if not legacy_row or not nova_row:
                print(f"  [!] Par no encontrado: {legacy_name!r} / {nova_name!r}")
                continue
            if legacy_row[0] == nova_row[0]:
                print(f"  [=] Ya es la misma fila: {legacy_name!r}")
                continue

            merge_ops.append({
                "canonical_id":      nova_row[0],
                "canonical_name":    nova_row[1],
                "novalogic_id":      nova_row[3],
                "legacy_id_to_drop": legacy_row[0],
                "legacy_mongo_id":   legacy_row[2],
            })

    # Duplicados exactos también se fusionan
    with conn.cursor() as cur:
        for row in exact_dups:
            ids, legacies, novas = row[2], row[3], row[4]
            # canónico = el que tiene novalogic_id (primero después del ORDER BY)
            canonical_id   = ids[0]
            legacy_id_drop = ids[1] if len(ids) > 1 else None
            legacy_mongo   = next((l for l in legacies if l), None)
            nova_id        = next((n for n in novas if n), None)
            if legacy_id_drop:
                merge_ops.append({
                    "canonical_id":      canonical_id,
                    "canonical_name":    row[0],
                    "novalogic_id":      nova_id,
                    "legacy_id_to_drop": legacy_id_drop,
                    "legacy_mongo_id":   legacy_mongo,
                })

    print(f"\nOperaciones de merge a ejecutar: {len(merge_ops)}")
    for op in merge_ops:
        tag = "MERGE" if not dry_run else "DRY"
        print(f"  [{tag}] {op['canonical_name']!r}")
        print(f"         canónico={op['canonical_id']}  legacy_mongo={op['legacy_mongo_id']}")
        print(f"         eliminar={op['legacy_id_to_drop']}")

    if dry_run:
        print("\n[DRY RUN] No se aplican cambios.")
        conn.close()
        return

    # ── 3. Ejecutar merges ──────────────────────────────────────────────────
    total_merged = 0
    with conn.cursor() as cur:
        for op in merge_ops:
            # a) Redirigir cualquier FK que apunte al legacy_id → canonical_id PRIMERO
            for table, col in [
                ("fact_orders", "dim_employee_id"),
                ("fact_guides", "dim_employee_id"),
            ]:
                cur.execute(f"""
                    UPDATE simora_v2.{table}
                    SET {col} = %s
                    WHERE {col} = %s
                """, [op["canonical_id"], op["legacy_id_to_drop"]])

            # b) Eliminar la fila redundante (ANTES de setear legacy_mongo_id para liberar constraint)
            cur.execute("""
                DELETE FROM simora_v2.dim_employees WHERE id = %s
            """, [op["legacy_id_to_drop"]])

            # c) Actualizar el canónico con el legacy_mongo_id (ahora el constraint está libre)
            if op["legacy_mongo_id"]:
                cur.execute("""
                    UPDATE simora_v2.dim_employees
                    SET legacy_mongo_id = %s,
                        sources = ARRAY(
                            SELECT DISTINCT unnest(sources || ARRAY['legacy_mongo','novalogic'])
                        )
                    WHERE id = %s
                """, [op["legacy_mongo_id"], op["canonical_id"]])

            total_merged += 1

    # ── 4. Backfill dim_employee_id en fact_orders ───────────────────────────
    # Los IDs de MongoDB en dim_sellers.source_id y dim_employees.legacy_mongo_id
    # son distintos (misma persona, colecciones diferentes en Mongo).
    # Usamos nombre normalizado como puente.
    with conn.cursor() as cur:
        # Legacy: join por nombre normalizado seller ↔ employee
        cur.execute("""
            UPDATE simora_v2.fact_orders fo
            SET dim_employee_id = de.id
            FROM simora_v2.dim_sellers ds
            JOIN simora_v2.dim_employees de
              ON LOWER(TRIM(de.canonical_name)) = LOWER(TRIM(ds.full_name))
            WHERE fo.seller_id = ds.id
              AND fo.source = 'legacy_mongo'
              AND fo.dim_employee_id IS NULL
        """)
        orders_legacy = cur.rowcount
        print(f"\nfact_orders legacy backfill:    {orders_legacy:,}")

        # Novalogic: dim_sellers.source_id = employees.id (UUID del ERP)
        cur.execute("""
            UPDATE simora_v2.fact_orders fo
            SET dim_employee_id = de.id
            FROM simora_v2.dim_sellers ds
            JOIN simora_v2.dim_employees de
              ON de.novalogic_id::text = ds.source_id
            WHERE fo.seller_id = ds.id
              AND fo.source = 'novalogic'
              AND fo.dim_employee_id IS NULL
        """)
        orders_nova = cur.rowcount
        print(f"fact_orders novalogic backfill: {orders_nova:,}")

        # Guías: heredar de fact_orders
        cur.execute("""
            UPDATE simora_v2.fact_guides fg
            SET dim_employee_id = fo.dim_employee_id
            FROM simora_v2.fact_orders fo
            WHERE fg.order_id = fo.id
              AND fg.dim_employee_id IS NULL
              AND fo.dim_employee_id IS NOT NULL
        """)
        guides_fill = cur.rowcount
        print(f"fact_guides backfill (heredado): {guides_fill:,}")

    conn.commit()

    # ── 5. Resumen final ────────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              (SELECT COUNT(*) FROM simora_v2.dim_employees) AS total_employees,
              (SELECT COUNT(*) FROM simora_v2.dim_employees WHERE novalogic_id IS NOT NULL) AS linked,
              (SELECT COUNT(*) FROM simora_v2.fact_orders WHERE dim_employee_id IS NOT NULL) AS orders_attributed,
              (SELECT COUNT(*) FROM simora_v2.fact_orders) AS orders_total,
              (SELECT COUNT(*) FROM simora_v2.fact_guides WHERE dim_employee_id IS NOT NULL) AS guides_attributed,
              (SELECT COUNT(*) FROM simora_v2.fact_guides) AS guides_total
        """)
        r = cur.fetchone()
        print(f"\nResumen final:")
        print(f"  dim_employees:       {r[0]} total, {r[1]} con novalogic_id")
        print(f"  fact_orders:         {r[3]:,} total, {r[2]:,} atribuidos ({round(r[2]/r[3]*100,1)}%)")
        print(f"  fact_guides:         {r[5]:,} total, {r[4]:,} atribuidos ({round(r[4]/r[5]*100,1)}%)")

    conn.close()
    return {
        "merged": total_merged,
        "orders_legacy": orders_legacy,
        "orders_nova": orders_nova,
        "guides_fill": guides_fill,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.dry_run)
