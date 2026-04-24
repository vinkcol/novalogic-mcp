"""
Fix 16: Ciudad y departamento en dim_customers
===============================================
dim_customers.city y .department están 100% vacíos (21,731 clientes).

Estrategia:
  La señal más confiable es el historial de pedidos del cliente.
  Para cada customer_id en fact_orders, se toma la ciudad más frecuente
  (moda). En caso de empate, se usa la ciudad del pedido más reciente.

  También se puebla .department cuando fact_orders lo tiene.

  Clientes sin ninguna orden con ciudad → city/department quedan NULL.

Cobertura esperada: ~9,859 / 21,731 clientes (45%)
El resto son clientes sin pedidos con ciudad registrada.

Uso:
  python 16_customer_city.py --dry-run
  python 16_customer_city.py
"""

import sys
import json
import argparse
from pathlib import Path
from collections import Counter, defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def run(dry_run: bool):
    conn = simora_db.get_conn()

    # ── Cargar órdenes con ciudad ────────────────────────────────────────────
    print("Cargando órdenes con ciudad...")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT customer_id, city, department, order_date
            FROM simora_v2.fact_orders
            WHERE customer_id IS NOT NULL
              AND city IS NOT NULL AND city != ''
            ORDER BY order_date ASC
        """)
        rows = cur.fetchall()
    print(f"  Órdenes con ciudad: {len(rows):,}")

    # ── Calcular ciudad/depto por cliente (moda, desempate = más reciente) ──
    # Agrupamos: customer_id → lista de (city, department, order_date)
    by_customer: dict = defaultdict(list)
    for cid, city, dept, odate in rows:
        by_customer[str(cid)].append((city, dept, odate))

    resolved = {}   # customer_id → (city, department)
    for cid, entries in by_customer.items():
        # Frecuencia de ciudad
        city_count = Counter(city for city, _, _ in entries)
        max_freq = max(city_count.values())
        top_cities = [c for c, n in city_count.items() if n == max_freq]

        if len(top_cities) == 1:
            best_city = top_cities[0]
        else:
            # Desempate: ciudad del pedido más reciente
            recent = max(entries, key=lambda x: x[2] or "")
            best_city = recent[0]

        # Departamento: el asociado a esa ciudad en el pedido más reciente
        recent_with_city = max(
            (e for e in entries if e[0] == best_city),
            key=lambda x: x[2] or ""
        )
        best_dept = recent_with_city[1]
        resolved[cid] = (best_city, best_dept)

    print(f"  Clientes con ciudad inferida: {len(resolved):,}")

    # ── Preview distribución ─────────────────────────────────────────────────
    city_dist = Counter(city for city, _ in resolved.values())
    print(f"\n=== TOP 15 CIUDADES INFERIDAS ===")
    for city, n in city_dist.most_common(15):
        print(f"  {city:<30} {n:>6,}")

    dept_dist = Counter(dept for _, dept in resolved.values() if dept)
    if dept_dist:
        print(f"\n=== TOP 10 DEPARTAMENTOS INFERIDOS ===")
        for dept, n in dept_dist.most_common(10):
            print(f"  {dept:<30} {n:>6,}")

    # Clientes sin ciudad
    no_city = 21731 - len(resolved)  # aprox
    print(f"\n  Sin datos de ciudad : ~{no_city:,} clientes (sin órdenes con ciudad)")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        conn.close()
        return {
            "dry_run": True,
            "resolved": len(resolved),
            "top_cities": dict(city_dist.most_common(5)),
        }

    # ── Actualizar dim_customers ─────────────────────────────────────────────
    print(f"\nActualizando dim_customers...")
    updated = 0
    BATCH = 500
    items = list(resolved.items())

    with conn.cursor() as cur:
        for i in range(0, len(items), BATCH):
            batch = items[i:i + BATCH]
            for cid, (city, dept) in batch:
                cur.execute("""
                    UPDATE simora_v2.dim_customers
                    SET city       = %s,
                        department = COALESCE(department, %s)
                    WHERE id = %s
                      AND (city IS DISTINCT FROM %s
                           OR department IS DISTINCT FROM %s)
                """, [city, dept, cid, city, dept])
                updated += cur.rowcount
        conn.commit()

    print(f"  Filas actualizadas: {updated:,}")

    # ── Estado final ─────────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) AS total,
              COUNT(*) FILTER (WHERE city IS NOT NULL AND city != '') AS con_ciudad,
              COUNT(*) FILTER (WHERE city IS NULL OR city = '') AS sin_ciudad,
              COUNT(DISTINCT city) FILTER (WHERE city IS NOT NULL) AS ciudades_unicas
            FROM simora_v2.dim_customers
        """)
        r = cur.fetchone()
        pct = round(int(r[1]) / int(r[0]) * 100, 1)
        print(f"  Total clientes     : {int(r[0]):>8,}")
        print(f"  Con ciudad         : {int(r[1]):>8,}  ({pct}%)")
        print(f"  Sin ciudad         : {int(r[2]):>8,}")
        print(f"  Ciudades únicas    : {int(r[3]):>8,}")

    print("\n=== DISTRIBUCIÓN POR CIUDAD (top 15) ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT city, COUNT(*) n,
                   ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS pct
            FROM simora_v2.dim_customers
            WHERE city IS NOT NULL AND city != ''
            GROUP BY city
            ORDER BY n DESC
            LIMIT 15
        """)
        print(f"  {'Ciudad':<30} {'clientes':>9}  {'%':>6}")
        print("  " + "-" * 48)
        for r in cur.fetchall():
            print(f"  {str(r[0]):<30} {int(r[1]):>9,}  {float(r[2]):>5.1f}%")

    # ── Cruce revenue por ciudad ─────────────────────────────────────────────
    print("\n=== REVENUE POR CIUDAD DE CLIENTE (top 10) ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT dc.city,
                   COUNT(DISTINCT fo.id)    AS pedidos,
                   COALESCE(SUM(fo.total),0) AS revenue,
                   COUNT(DISTINCT dc.id)    AS clientes
            FROM simora_v2.dim_customers dc
            JOIN simora_v2.fact_orders fo ON fo.customer_id = dc.id
            WHERE dc.city IS NOT NULL
            GROUP BY dc.city
            ORDER BY revenue DESC
            LIMIT 10
        """)
        print(f"  {'Ciudad':<30} {'pedidos':>8}  {'clientes':>9}  {'revenue':>16}")
        print("  " + "-" * 70)
        for r in cur.fetchall():
            print(f"  {str(r[0]):<30} {int(r[1]):>8,}  {int(r[3]):>9,}  ${int(r[2]):>15,}")

    # ── Bitácora ─────────────────────────────────────────────────────────────
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
                "medium",
                "Fix 16: city y department inferidos en dim_customers",
                (
                    f"Se pobló city/department en {updated:,} clientes de 21,731. "
                    f"Método: ciudad más frecuente en historial de pedidos (moda). "
                    f"Desempate por pedido más reciente. "
                    f"Top ciudad: {city_dist.most_common(1)[0][0]} "
                    f"({city_dist.most_common(1)[0][1]:,} clientes). "
                    f"~{no_city:,} clientes sin datos de ciudad disponibles."
                ),
                ["fix", "clientes", "ciudad", "geografia"],
                "16_customer_city.py",
                updated,
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "resolved": len(resolved),
        "updated": updated,
        "top_cities": dict(city_dist.most_common(5)),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
