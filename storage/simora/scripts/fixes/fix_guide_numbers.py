"""
Fix guide numbers en fact_courier_reports
==========================================
Problemas a resolver:
  1. Zero-padding mismatch: courier usa MAG0030, sistema usa MAG00030
  2. Duplicados: la misma guia aparece en varios archivos (meses distintos)
     o incluso en el mismo archivo con distinto padding

Estrategia:
  Para cada grupo numerico (todos los MAG con el mismo numero):
    - Ordenar todas las filas por (report_date DESC, id DESC) → orden total
    - Fila 0 (mas reciente): guide_number = canon  (sin sufijo)
    - Fila 1:                guide_number = canon-1
    - Fila 2:                guide_number = canon-2
    - ...
  Esto garantiza unicidad absoluta y nunca genera colisiones de constraint.

Uso:
  python fix_guide_numbers.py --dry-run   # muestra cambios sin aplicar
  python fix_guide_numbers.py             # aplica los cambios
"""

import re
import sys
import argparse
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def parse_mag(g: str):
    """Retorna (prefix, numeric_val) o None si no es formato MAG valido."""
    m = re.match(r"^(MAG)0*(\d+)$", g, re.IGNORECASE)
    if m:
        return m.group(1).upper(), int(m.group(2))
    return None


def canonical_format(variants: list[str], sistema_by_num: dict[int, str], num: int) -> str:
    """
    Elige el formato canonico para un grupo de variantes del mismo numero:
    1. Si el sistema tiene este numero (con cualquier padding), usa ese formato.
    2. Si no, usa la variante mas larga del courier.
    """
    if num in sistema_by_num:
        return sistema_by_num[num]
    return max(variants, key=len)


def run(dry_run: bool):
    conn = simora_db.get_conn()
    with conn.cursor() as cur:
        # ── 1. Formatos canonicos del sistema indexados por valor numerico ────────
        cur.execute(
            "SELECT DISTINCT guide_number FROM simora_v2.fact_guides "
            "WHERE guide_number LIKE 'MAG%%'"
        )
        sistema_by_num: dict[int, str] = {}
        for (g,) in cur.fetchall():
            parsed = parse_mag(g)
            if parsed:
                num_val, fmt = parsed[1], g
                # Si hay varios formatos para el mismo numero, usa el mas largo
                if num_val not in sistema_by_num or len(g) > len(sistema_by_num[num_val]):
                    sistema_by_num[num_val] = g

        # ── 2. Todas las filas MAG del courier ────────────────────────────────
        cur.execute(
            "SELECT id, guide_number, source_file, report_date "
            "FROM simora_v2.fact_courier_reports "
            "WHERE guide_number LIKE 'MAG%%'"
        )
        courier_rows = cur.fetchall()  # (id, guide_number, source_file, report_date)

    # ── 3. Agrupar por valor numerico ─────────────────────────────────────────
    groups: dict[int, list] = defaultdict(list)
    skipped = []
    for row in courier_rows:
        parsed = parse_mag(row[1])
        if parsed:
            groups[parsed[1]].append(row)
        else:
            skipped.append(row[1])

    print(f"Grupos numericos unicos: {len(groups)}")
    print(f"Filas no-MAG omitidas:   {len(skipped)}")

    # ── 4. Calcular actualizaciones ───────────────────────────────────────────
    # Clave: dict {row_id -> new_guide} para unicidad por fila
    updates: dict[int, str] = {}

    for num, rows in groups.items():
        variants  = list({r[1] for r in rows})
        canon     = canonical_format(variants, sistema_by_num, num)

        if len(rows) == 1:
            # Grupo de una sola fila: solo corregir padding si hace falta
            row = rows[0]
            if row[1] != canon:
                updates[row[0]] = canon
            continue

        # Multiples filas: ordenar de mas reciente a mas antiguo.
        # Tiebreaker: preferir la fila que ya tiene el formato canonico
        # (evita renombrar la que estaba bien para dejar pasar la mal-escrita)
        sorted_rows = sorted(
            rows,
            key=lambda r: (r[3], r[1] == canon, r[0]),
            reverse=True,
        )

        for idx, row in enumerate(sorted_rows):
            new_guide = canon if idx == 0 else f"{canon}-{idx}"
            if row[1] != new_guide:
                updates[row[0]] = new_guide

    real_suffix  = sum(1 for v in updates.values() if re.search(r"-\d+$", v))
    real_padding = len(updates) - real_suffix

    print(f"\nActualizaciones calculadas: {len(updates)} filas unicas")
    print(f"  - Zero-padding corregido:  {real_padding}")
    print(f"  - Sufijo -N por duplicado: {real_suffix}")

    if dry_run:
        print("\n[DRY RUN] Muestra de cambios (25 primeras):")
        conn2 = simora_db.get_conn()
        items = sorted(updates.items(), key=lambda x: (x[1], x[0]))
        with conn2.cursor() as cur2:
            for row_id, new_guide in items[:25]:
                cur2.execute(
                    "SELECT guide_number, source_file, report_date::text "
                    "FROM simora_v2.fact_courier_reports WHERE id = %s",
                    [row_id],
                )
                r = cur2.fetchone()
                if r:
                    tag = "DUP" if re.search(r"-\d+$", new_guide) else "PAD"
                    print(f"  [{tag}] {r[0]:20s} -> {new_guide:25s}  [{r[1]} | {r[2]}]")
        if len(updates) > 25:
            print(f"  ... y {len(updates)-25} cambios mas")
        conn2.close()
        conn.close()
        return

    # ── 5. Aplicar: primero sufijos (liberan constraint), luego paddings ──────
    suffix_ids  = [(rid, g) for rid, g in updates.items() if re.search(r"-\d+$", g)]
    padding_ids = [(rid, g) for rid, g in updates.items() if not re.search(r"-\d+$", g)]

    with conn.cursor() as cur:
        for row_id, new_guide in suffix_ids:
            cur.execute(
                "UPDATE simora_v2.fact_courier_reports "
                "SET guide_number = %s WHERE id = %s",
                [new_guide, row_id],
            )
        for row_id, new_guide in padding_ids:
            cur.execute(
                "UPDATE simora_v2.fact_courier_reports "
                "SET guide_number = %s WHERE id = %s",
                [new_guide, row_id],
            )

    conn.commit()
    conn.close()
    print(f"\nAplicado: {len(suffix_ids)} sufijos + {len(padding_ids)} zero-padding fixes")
    print("Listo.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.dry_run)
