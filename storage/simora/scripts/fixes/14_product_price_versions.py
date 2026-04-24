"""
Fix 14: Versionado de precios en dim_product_prices
====================================================
Crea la tabla simora_v2.dim_product_prices con historial de precios
(SCD Type 2) e infiere versiones desde fact_order_items.

Schema:
  id           UUID PK
  product_id   UUID → dim_products
  price        NUMERIC(12,2)   — precio de lista en ese período
  valid_from   DATE            — primera venta a este precio (o fecha manual)
  valid_to     DATE            — NULL = precio vigente hoy
  source       VARCHAR(30)     — 'inferred_from_sales' | 'dim_products' | 'manual'
  n_sales      INTEGER         — ventas observadas en ese período (auditoría)
  revenue      NUMERIC         — revenue total en ese período
  created_at   TIMESTAMPTZ

Algoritmo de backfill:
  1. Calcular el precio dominante (moda) por producto × mes desde fact_order_items.
  2. Detectar runs consecutivos del mismo precio (RLE).
  3. Crear una versión por run → valid_from = primer mes del run,
     valid_to = último día del mes anterior al siguiente run.
  4. El run más reciente → valid_to = NULL (precio vigente).
  5. Para productos sin ventas → insertar el precio actual de dim_products
     con source='dim_products'.

Uso:
  python 14_product_price_versions.py --dry-run
  python 14_product_price_versions.py
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import date, timedelta
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


# ── DDL ───────────────────────────────────────────────────────────────────────
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS simora_v2.dim_product_prices (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id   UUID        NOT NULL REFERENCES simora_v2.dim_products(id),
    price        NUMERIC(12,2) NOT NULL,
    valid_from   DATE        NOT NULL,
    valid_to     DATE,
    source       VARCHAR(30) NOT NULL DEFAULT 'inferred_from_sales',
    n_sales      INTEGER     DEFAULT 0,
    revenue      NUMERIC(14,2) DEFAULT 0,
    created_at   TIMESTAMPTZ DEFAULT NOW(),

    CONSTRAINT uq_product_price_period
        UNIQUE (product_id, valid_from)
);

CREATE INDEX IF NOT EXISTS idx_dpp_product_valid
    ON simora_v2.dim_product_prices (product_id, valid_from, valid_to);
"""


def ensure_table(conn):
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE_SQL)
    conn.commit()


# ── Consulta de precios mensuales dominantes ──────────────────────────────────
MONTHLY_PRICES_SQL = """
WITH monthly AS (
    SELECT
        foi.product_id,
        DATE_TRUNC('month', fo.order_date)::date AS month,
        foi.unit_price                            AS price,
        COUNT(*)                                  AS cnt,
        SUM(foi.total)                            AS revenue
    FROM simora_v2.fact_order_items foi
    JOIN simora_v2.fact_orders fo ON fo.id = foi.order_id
    WHERE foi.unit_price > 0
      AND foi.quantity   > 0
      AND foi.product_id IS NOT NULL
    GROUP BY foi.product_id,
             DATE_TRUNC('month', fo.order_date)::date,
             foi.unit_price
),
dominant AS (
    SELECT DISTINCT ON (product_id, month)
        product_id,
        month,
        price,
        cnt   AS n_sales,
        revenue
    FROM monthly
    ORDER BY product_id, month, cnt DESC
)
SELECT product_id, month, price, n_sales, revenue
FROM dominant
ORDER BY product_id, month
"""


def last_day_of_month(d: date) -> date:
    """Último día del mes de d."""
    if d.month == 12:
        return date(d.year, 12, 31)
    return date(d.year, d.month + 1, 1) - timedelta(days=1)


def build_price_versions(rows: list) -> list:
    """
    Recibe lista de (product_id, month, price, n_sales, revenue) ordenada.
    Retorna lista de versiones:
      (product_id, price, valid_from, valid_to, source, n_sales, revenue)
    """
    # Agrupar por producto
    by_product = defaultdict(list)
    for pid, month, price, n_sales, revenue in rows:
        by_product[str(pid)].append((month, float(price), int(n_sales), float(revenue or 0)))

    versions = []
    for pid, timeline in by_product.items():
        # Detectar runs (RLE)
        runs = []  # [(price, first_month, last_month, total_n, total_rev)]
        for month, price, n, rev in timeline:
            if runs and runs[-1][0] == price:
                # Mismo precio — extender run
                r = runs[-1]
                runs[-1] = (r[0], r[1], month, r[3] + n, r[4] + rev)
            else:
                # Nuevo precio → nuevo run
                runs.append((price, month, month, n, rev))

        # Convertir runs a versiones con valid_from / valid_to
        for i, (price, first_month, last_month, total_n, total_rev) in enumerate(runs):
            valid_from = first_month
            if i < len(runs) - 1:
                # valid_to = último día del mes anterior al siguiente run
                next_first_month = runs[i + 1][1]
                valid_to = next_first_month - timedelta(days=1)
            else:
                valid_to = None  # precio vigente

            versions.append((
                pid, price, valid_from, valid_to,
                'inferred_from_sales', total_n, total_rev
            ))

    return versions


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_table(conn)

    # ── 1. Cargar precios mensuales desde ventas ───────────────────────────
    print("Calculando precios dominantes por producto × mes...")
    with conn.cursor() as cur:
        cur.execute(MONTHLY_PRICES_SQL)
        rows = cur.fetchall()
    print(f"  Observaciones mensuales: {len(rows):,}")

    # ── 2. Construir versiones ─────────────────────────────────────────────
    versions = build_price_versions(rows)
    print(f"  Versiones de precio detectadas: {len(versions):,}")

    # ── 3. Productos sin ventas → usar precio de dim_products ──────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT p.id, p.unit_price
            FROM simora_v2.dim_products p
            WHERE p.unit_price > 0
              AND NOT EXISTS (
                  SELECT 1 FROM simora_v2.fact_order_items foi
                  WHERE foi.product_id = p.id AND foi.unit_price > 0
              )
        """)
        no_sales = cur.fetchall()

    for pid, price in no_sales:
        if price and float(price) > 0:
            versions.append((
                str(pid), float(price),
                date(2024, 1, 1),   # fecha de inicio conservadora
                None,
                'dim_products', 0, 0
            ))
    print(f"  Productos sin ventas (precio de catálogo): {len(no_sales):,}")

    # ── 4. Preview ────────────────────────────────────────────────────────
    multi_version = [
        (pid, [(p, vf, vt) for p2, vf, vt, *_ in [] if p2 == pid])
        for pid in set(v[0] for v in versions)
    ]
    # Productos con más de 1 versión = cambios de precio
    from collections import Counter
    versions_per_product = Counter(v[0] for v in versions)
    changed = {pid: n for pid, n in versions_per_product.items() if n > 1}

    print(f"\n=== RESUMEN ===")
    print(f"  Productos con historial único   : {len(versions_per_product) - len(changed):,}")
    print(f"  Productos con cambios de precio : {len(changed):,}")
    print(f"  Total versiones a insertar      : {len(versions):,}")

    if changed:
        # Mostrar los productos con más cambios
        with conn.cursor() as cur:
            cur.execute("SELECT id, name FROM simora_v2.dim_products")
            product_names = {str(r[0]): r[1] for r in cur.fetchall()}

        print(f"\n=== CAMBIOS DE PRECIO DETECTADOS ===")
        print(f"  {'Producto':<55} {'Versiones':>9}")
        print("  " + "-"*70)
        for pid, n_versions in sorted(changed.items(), key=lambda x: -x[1]):
            name = product_names.get(pid, pid[:8])
            print(f"  {name:<55} {n_versions:>9}")

        print(f"\n=== DETALLE DE VERSIONES (productos con cambios) ===")
        for pid, n_versions in sorted(changed.items(), key=lambda x: -x[1])[:20]:
            name = product_names.get(pid, pid[:8])
            print(f"\n  {name}")
            product_versions = sorted(
                [v for v in versions if v[0] == pid],
                key=lambda x: x[2]
            )
            for _, price, vf, vt, src, n_s, rev in product_versions:
                vt_str = str(vt) if vt else "vigente"
                rev_str = f"{int(rev):,}" if rev else "0"
                print(f"    {str(vf):<12} → {vt_str:<12}  ${int(price):>8,}  "
                      f"({n_s:>4} ventas, ${rev_str} revenue)")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        conn.close()
        return {
            "dry_run": True,
            "total_versions": len(versions),
            "products_with_changes": len(changed),
        }

    # ── 5. Insertar versiones ─────────────────────────────────────────────
    print(f"\nInsertando versiones de precio...")
    # Limpiar tabla primero (idempotente)
    with conn.cursor() as cur:
        cur.execute("TRUNCATE simora_v2.dim_product_prices")

    inserted = 0
    BATCH = 500
    with conn.cursor() as cur:
        for i in range(0, len(versions), BATCH):
            batch = versions[i:i + BATCH]
            for pid, price, valid_from, valid_to, source, n_sales, revenue in batch:
                cur.execute("""
                    INSERT INTO simora_v2.dim_product_prices
                      (product_id, price, valid_from, valid_to, source, n_sales, revenue)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (product_id, valid_from) DO UPDATE
                      SET price    = EXCLUDED.price,
                          valid_to = EXCLUDED.valid_to,
                          n_sales  = EXCLUDED.n_sales,
                          revenue  = EXCLUDED.revenue
                """, [pid, price, valid_from, valid_to, source, n_sales, revenue])
                inserted += cur.rowcount
    conn.commit()
    print(f"  Versiones insertadas: {inserted:,}")

    # ── 6. Auditoría post-insert ───────────────────────────────────────────
    print("\n" + "=" * 70)
    print("AUDITORÍA DE PRECIOS")
    print("=" * 70)

    # 6a. Distribución de versiones
    with conn.cursor() as cur:
        cur.execute("""
            SELECT version_count, COUNT(*) AS products
            FROM (
                SELECT product_id, COUNT(*) AS version_count
                FROM simora_v2.dim_product_prices
                GROUP BY product_id
            ) t
            GROUP BY version_count
            ORDER BY version_count
        """)
        print("\n  Versiones por producto:")
        print(f"  {'# versiones':>12}  {'productos':>10}")
        for row in cur.fetchall():
            bar = "█" * min(int(row[1] / 2), 30)
            print(f"  {int(row[0]):>12}  {int(row[1]):>10}  {bar}")

    # 6b. Productos con mayor variación de precio (rango %)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              dp.name,
              dp.canal_venta,
              dp.pack_size,
              MIN(pp.price)                                      AS price_min,
              MAX(pp.price)                                      AS price_max,
              COUNT(pp.id)                                       AS n_versions,
              ROUND((MAX(pp.price) - MIN(pp.price))
                    / NULLIF(MIN(pp.price), 0) * 100, 1)        AS pct_change,
              SUM(pp.revenue)                                    AS total_revenue
            FROM simora_v2.dim_product_prices pp
            JOIN simora_v2.dim_products dp ON dp.id = pp.product_id
            WHERE pp.source = 'inferred_from_sales'
            GROUP BY dp.name, dp.canal_venta, dp.pack_size
            HAVING COUNT(pp.id) > 1
            ORDER BY pct_change DESC NULLS LAST
        """)
        rows_audit = cur.fetchall()
        print(f"\n  Productos con cambio de precio (ordenado por % variación):")
        print(f"  {'Producto':<52} {'canal':>10} {'pack':>5}  "
              f"{'min':>8}  {'max':>8}  {'Δ%':>6}  {'versions':>8}")
        print("  " + "-"*110)
        for row in rows_audit:
            canal = str(row[1]) if row[1] else '-'
            pct = f"{float(row[6]):.1f}%" if row[6] else '-'
            print(f"  {str(row[0]):<52} {canal:>10} X{int(row[2] or 1):<4}  "
                  f"{int(row[3]):>8,}  {int(row[4]):>8,}  {pct:>6}  {int(row[5]):>8}")

    # 6c. Línea de tiempo de precios del producto estrella
    with conn.cursor() as cur:
        cur.execute("""
            SELECT dp.name, pp.price, pp.valid_from, pp.valid_to,
                   pp.n_sales, pp.revenue
            FROM simora_v2.dim_product_prices pp
            JOIN simora_v2.dim_products dp ON dp.id = pp.product_id
            WHERE dp.name ILIKE '%uñas perfectas%'
               OR dp.name ILIKE '%dúo uñas%'
            ORDER BY dp.name, pp.valid_from
        """)
        rows_star = cur.fetchall()
        if rows_star:
            print(f"\n  Historial de precios — productos estrella:")
            current_name = None
            for row in rows_star:
                if row[0] != current_name:
                    current_name = row[0]
                    print(f"\n  {current_name}")
                vt = str(row[3]) if row[3] else 'vigente    '
                rev = int(row[5]) if row[5] else 0
                print(f"    {str(row[2])} → {vt}  ${int(row[1]):>8,}  "
                      f"({int(row[4] or 0):>4} ventas, ${rev:>14,})")

    # 6d. Cobertura de join (¿cuántas fact_order_items se pueden enlazar con precio?)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*)                                                     AS total_lines,
              COUNT(pp.id)                                                 AS lines_with_price,
              ROUND(COUNT(pp.id)::numeric / NULLIF(COUNT(*),0) * 100, 1)  AS coverage_pct
            FROM simora_v2.fact_order_items foi
            JOIN simora_v2.fact_orders fo ON fo.id = foi.order_id
            LEFT JOIN simora_v2.dim_product_prices pp
                   ON pp.product_id = foi.product_id
                  AND fo.order_date::date >= pp.valid_from
                  AND fo.order_date::date <= COALESCE(pp.valid_to, CURRENT_DATE)
            WHERE foi.unit_price > 0
        """)
        cov = cur.fetchone()
        print(f"\n  Cobertura de join fact_order_items → dim_product_prices:")
        print(f"    Total líneas     : {int(cov[0]):>10,}")
        print(f"    Con precio hist. : {int(cov[1]):>10,}")
        print(f"    Cobertura        : {float(cov[2]):>10.1f}%")

    # ── 7. Bitácora ───────────────────────────────────────────────────────
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
                "low",
                "Fix 14: dim_product_prices creada con historial de precios",
                (
                    f"Tabla dim_product_prices creada. "
                    f"{inserted} versiones de precio insertadas. "
                    f"Productos con cambios de precio: {len(changed)}. "
                    f"Algoritmo: precio dominante (moda) por producto×mes, "
                    f"deteccion de runs consecutivos (RLE). "
                    f"Source: inferred_from_sales para productos con ventas, "
                    f"dim_products para productos sin ventas ({len(no_sales)})."
                ),
                ["fix", "precios", "scd2", "price_history", "dim_product_prices"],
                "14_product_price_versions.py",
                inserted,
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "total_versions": inserted,
        "products_with_changes": len(changed),
        "products_no_sales": len(no_sales),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
