"""
Fix 18: unit_price en dim_products sin precio
=============================================
49 productos tienen unit_price = NULL o 0.
Se infiere el precio base como la moda del unit_price en fact_order_items
(precio que más veces apareció en ventas reales).

Si un producto no tiene ventas con precio > 0 → queda sin precio.

Uso:
  python 18_product_unit_price.py --dry-run
  python 18_product_unit_price.py
"""

import sys
import json
import argparse
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def run(dry_run: bool):
    conn = simora_db.get_conn()

    # Productos sin precio
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, name, product_type, canal_venta
            FROM simora_v2.dim_products
            WHERE unit_price IS NULL OR unit_price = 0
        """)
        no_price = cur.fetchall()
    print(f"Productos sin unit_price: {len(no_price)}")

    # Inferir moda de unit_price desde ventas
    with conn.cursor() as cur:
        cur.execute("""
            SELECT product_id, unit_price, COUNT(*) AS n
            FROM simora_v2.fact_order_items
            WHERE product_id IS NOT NULL
              AND unit_price IS NOT NULL AND unit_price > 0
            GROUP BY product_id, unit_price
        """)
        rows = cur.fetchall()

    # Agrupar por producto
    price_votes: dict[str, Counter] = {}
    for pid, price, n in rows:
        key = str(pid)
        if key not in price_votes:
            price_votes[key] = Counter()
        price_votes[key][float(price)] += int(n)

    # Calcular moda por producto
    resolved = {}
    for pid, name, ptype, canal in no_price:
        key = str(pid)
        if key in price_votes:
            best_price = price_votes[key].most_common(1)[0][0]
            resolved[key] = (int(best_price), name, ptype, canal)

    print(f"Productos con precio inferible : {len(resolved)}")
    print(f"Productos sin ventas (no inferible): {len(no_price) - len(resolved)}")

    print(f"\n=== PRECIOS INFERIDOS ===")
    print(f"  {'Nombre':<55} {'tipo':<16} {'canal':<10} {'precio':>10}")
    print("  " + "-" * 95)
    for pid, (price, name, ptype, canal) in sorted(resolved.items(), key=lambda x: -x[1][0]):
        print(f"  {name:<55} {str(ptype):<16} {str(canal):<10} ${price:>9,}")

    no_data = [(str(pid), name) for pid, name, _, _ in no_price if str(pid) not in resolved]
    if no_data:
        print(f"\n=== SIN VENTAS (precio no inferible, {len(no_data)}) ===")
        for pid, name in no_data:
            print(f"  '{name}'")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        conn.close()
        return {"dry_run": True, "resolvable": len(resolved), "no_data": len(no_data)}

    # Actualizar
    print(f"\nActualizando dim_products.unit_price...")
    updated = 0
    with conn.cursor() as cur:
        for pid, (price, _, _, _) in resolved.items():
            cur.execute("""
                UPDATE simora_v2.dim_products
                SET unit_price = %s
                WHERE id = %s
                  AND (unit_price IS NULL OR unit_price = 0)
            """, [price, pid])
            updated += cur.rowcount
    conn.commit()
    print(f"  Filas actualizadas: {updated}")

    # Estado final
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) FILTER (WHERE unit_price IS NULL OR unit_price = 0) AS sin_precio,
              COUNT(*) FILTER (WHERE unit_price > 0) AS con_precio,
              COUNT(*) AS total
            FROM simora_v2.dim_products
        """)
        r = cur.fetchone()
        pct = round(int(r[1]) / int(r[2]) * 100, 1)
        print(f"\n  Total productos : {int(r[2]):>6,}")
        print(f"  Con unit_price  : {int(r[1]):>6,}  ({pct}%)")
        print(f"  Sin unit_price  : {int(r[0]):>6,}")

    # Bitácora
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
                "Fix 18: unit_price inferido para productos sin precio",
                (
                    f"Se infirió unit_price para {updated} de {len(no_price)} productos sin precio. "
                    f"Método: moda del unit_price en fact_order_items (precio más frecuente en ventas). "
                    f"Sin ventas (no inferible): {len(no_data)} productos."
                ),
                ["fix", "productos", "precio", "unit_price"],
                "18_product_unit_price.py",
                updated,
                "resolved",
            ])
        conn.commit()
        print("Bitácora actualizada.")
    except Exception as e:
        print(f"[!] Error en bitácora: {e}")

    conn.close()
    return {"resolvable": len(resolved), "updated": updated, "no_data": len(no_data)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
