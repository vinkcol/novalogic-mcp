"""
Fix 11: Clasificación de marca y categoría en dim_products
===========================================================
Agrega dos columnas a dim_products:

  marca     — a qué línea comercial pertenece el producto
              magibell   : línea Magibell / Magibella (rebrand Jan 2025+)
              magistral  : línea Magistral (marca anterior, deprecada Dic 2024)
              sin_marca  : herramientas, accesorios, complementos sin marca propia

  categoria — qué tipo de producto es (independiente de la marca)
              kit          : kits, dúos, cajas, cajitas, bundles
              base         : base endurecedora (todas las presentaciones)
              removedor    : removedor de esmalte / cutícula
              esmalte      : esmaltes de color individuales
              lima         : limas de manicure (todas las variantes)
              herramienta  : bloque, pusher, palito, piedra pómez, cepillo,
                             corta cutícula, funda
              oleo         : óleo humectante de cutícula
              exfoliante   : exfoliante corporal
              vela         : vela hidratante corporal
              cosmetiquera : cosmetiquera / bolso de maquillaje
              obsequio     : items regalo (precio $0, no se venden solos)
              otro         : biotina, hidratante vitamínico, algodón,
                             lámina de sticker, excedente para ajuste

Regla temporal de marca:
  - Magistral fue deprecada en Dic 2024 / Ene 2025.
  - Productos legacy_mongo sin sufijo de marca que sean kit/base/removedor
    → magistral (eran de la era anterior al rebrand).
  - Todo lo de novalogic → magibell (post-rebrand).

Uso:
  python 11_classify_products.py --dry-run
  python 11_classify_products.py
"""

import sys
import json
import argparse
import unicodedata
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def norm(s: str) -> str:
    s = str(s).lower().strip()
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")


def classify(name: str, source: str) -> tuple[str, str]:
    """Retorna (marca, categoria)."""
    n = norm(name)

    # ── CATEGORIA ──────────────────────────────────────────────────────────────
    if "obsequio" in n:
        cat = "obsequio"
    elif (n.startswith("kit ") or n.startswith("duo ") or n.startswith("duo ")
          or n.startswith("cajita ") or n.startswith("caja ")
          or n.startswith("magibella")
          or "duo unas" in n or "duo hidratante" in n):
        cat = "kit"
    elif "base endurecedora" in n:
        cat = "base"
    elif "removedor" in n:
        cat = "removedor"
    elif "esmalte" in n:
        cat = "esmalte"
    elif "lima" in n or "funda lima" in n:
        cat = "lima"
    elif any(x in n for x in ("bloque", "pusher", "palito", "piedra pomez",
                               "piedra pomez", "cepillo", "corta cutic")):
        cat = "herramienta"
    elif "oleo" in n or "oleo" in n:
        cat = "oleo"
    elif "exfoliante" in n:
        cat = "exfoliante"
    elif "vela" in n:
        cat = "vela"
    elif "cosmetiquera" in n:
        cat = "cosmetiquera"
    else:
        cat = "otro"   # biotina, hidratante vitaminico, algodon, lamina, excedente

    # ── MARCA ──────────────────────────────────────────────────────────────────
    if "magibell" in n or "magibella" in n:
        marca = "magibell"
    elif source == "novalogic":
        # Todo lo de novalogic es post-rebrand Magibell
        marca = "magibell"
    elif "magistral" in n:
        marca = "magistral"
    elif source == "legacy_mongo" and cat in ("kit", "base", "removedor"):
        # legacy sin sufijo de marca en categorías principales = era Magistral
        marca = "magistral"
    else:
        marca = "sin_marca"

    return marca, cat


def ensure_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.dim_products
              ADD COLUMN IF NOT EXISTS marca     VARCHAR(20),
              ADD COLUMN IF NOT EXISTS categoria VARCHAR(20)
        """)
    conn.commit()


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_columns(conn)

    # Cargar todos los productos
    with conn.cursor() as cur:
        cur.execute("SELECT id, name, source::text FROM simora_v2.dim_products")
        products = cur.fetchall()

    print(f"Productos cargados: {len(products)}")

    # Clasificar
    classified = []
    for pid, name, source in products:
        marca, cat = classify(name, source)
        classified.append((str(pid), marca, cat, name, source))

    # ── Preview agrupado ───────────────────────────────────────────────────────
    by_marca_cat = defaultdict(list)
    for pid, marca, cat, name, source in classified:
        by_marca_cat[(marca, cat)].append(name)

    print("\n=== DISTRIBUCIÓN PROPUESTA ===")
    print(f"  {'marca':<12} {'categoria':<14} {'n':>4}  ejemplos")
    print("  " + "-" * 80)
    for (marca, cat), names in sorted(by_marca_cat.items()):
        ejemplos = ", ".join(names[:3])
        if len(names) > 3:
            ejemplos += f"... (+{len(names)-3})"
        print(f"  {marca:<12} {cat:<14} {len(names):>4}  {ejemplos}")

    print(f"\n  Total: {len(classified)} productos")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")

        # Mostrar tabla completa para revisión
        print("\n=== TABLA COMPLETA (para revisión) ===")
        print(f"  {'Nombre':<58} {'Fuente':<13} {'marca':<12} {'categoria'}")
        print("  " + "-" * 105)
        for _, marca, cat, name, source in sorted(classified, key=lambda x: (x[1], x[2], x[3])):
            print(f"  {name:<58} {source:<13} {marca:<12} {cat}")

        conn.close()
        return {"dry_run": True, "total": len(classified),
                "distribution": {f"{m}:{c}": len(v) for (m, c), v in by_marca_cat.items()}}

    # ── Actualizar ──────────────────────────────────────────────────────────────
    print(f"\nActualizando dim_products...")
    updated = 0
    BATCH = 200
    with conn.cursor() as cur:
        for i in range(0, len(classified), BATCH):
            batch = classified[i:i + BATCH]
            for pid, marca, cat, _, _ in batch:
                cur.execute("""
                    UPDATE simora_v2.dim_products
                    SET marca     = %s,
                        categoria = %s
                    WHERE id = %s
                      AND (marca IS DISTINCT FROM %s OR categoria IS DISTINCT FROM %s)
                """, [marca, cat, pid, marca, cat])
                updated += cur.rowcount
    conn.commit()
    print(f"  Filas actualizadas: {updated}")

    # ── Estado final ────────────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT marca, categoria,
                   COUNT(*) AS productos,
                   COUNT(foi.id) AS order_lines,
                   SUM(foi.total) AS revenue
            FROM simora_v2.dim_products p
            LEFT JOIN simora_v2.fact_order_items foi ON foi.product_id = p.id
            GROUP BY marca, categoria
            ORDER BY marca, revenue DESC NULLS LAST
        """)
        print(f"  {'marca':<12} {'categoria':<14} {'prods':>6}  {'líneas':>8}  {'revenue':>16}")
        print("  " + "-" * 65)
        for row in cur.fetchall():
            rev = int(row[4]) if row[4] else 0
            print(f"  {str(row[0]):<12} {str(row[1]):<14} {int(row[2]):>6}  "
                  f"{int(row[3] or 0):>8,}  {rev:>16,}")

    # ── Bitácora ────────────────────────────────────────────────────────────────
    try:
        dist_str = "; ".join(f"{m}/{c}={len(v)}" for (m, c), v in sorted(by_marca_cat.items()))
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
                "Fix 11: marca y categoria clasificados en dim_products",
                (
                    f"Clasificacion de {len(classified)} productos. "
                    f"Reglas: magibell=nombre contiene Magibell/Magibella o source=novalogic; "
                    f"magistral=nombre contiene magistral o legacy kit/base/removedor sin marca; "
                    f"sin_marca=herramientas/complementos/obsequios. "
                    f"Distribucion: {dist_str}. "
                    f"Nota: Magistral deprecada Dic 2024 / Ene 2025."
                ),
                ["fix", "productos", "marca", "categoria"],
                "11_classify_products.py",
                len(classified),
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "total": len(classified),
        "updated": updated,
        "distribution": {f"{m}:{c}": len(v) for (m, c), v in by_marca_cat.items()},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
