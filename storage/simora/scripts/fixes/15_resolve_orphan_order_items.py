"""
Fix 15: Resolver fact_order_items huérfanos (product_id IS NULL)
================================================================
2,744 líneas de pedido sin product_id vinculado representan ~$104M de revenue
sin asignar a ningún producto en dim_products.

Rutas de resolución:
  A — Coincidencia exacta por nombre (case-insensitive)
      LOWER(TRIM(dp.name)) = LOWER(TRIM(foi.product_name))
      Cuando hay múltiples candidatos con el mismo nombre (legacy + novalogic),
      se prefiere source='novalogic'. Cubre ~2,480 líneas.

  B — Notación "Producto - Variante"
      Nombres del tipo "Esmalte de color - Algodón de azúcar":
        1. Partir en " - " → nombre_base + variante
        2. Buscar variant_master en dim_products cuyo nombre normalizado
           coincida con nombre_base
        3. Buscar variant_instance bajo ese master con variant_value
           normalizado == variante normalizada
      Cubre ~264 líneas.

Desempate (si aún hay ambigüedad después de preferir novalogic):
  → Se elige el dim_product con mayor cantidad de apariciones previas
    en fact_order_items.product_id (el "más usado").

Uso:
  python 15_resolve_orphan_order_items.py --dry-run
  python 15_resolve_orphan_order_items.py
"""

import sys
import re
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


def load_orphans(conn) -> list:
    """Carga todos los fact_order_items con product_id IS NULL."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, product_name, source_product_id,
                   unit_price, quantity, total
            FROM simora_v2.fact_order_items
            WHERE product_id IS NULL
              AND product_name IS NOT NULL
              AND product_name != ''
        """)
        return cur.fetchall()


def load_dim_products(conn) -> list:
    """Carga dim_products con columnas necesarias."""
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, name, source::text,
                   product_type, canonical_id,
                   variant_value
            FROM simora_v2.dim_products
        """)
        return cur.fetchall()


def build_usage_counts(conn) -> dict:
    """
    Cuenta cuántas veces aparece cada product_id en fact_order_items.product_id
    (líneas ya resueltas). Sirve como desempate cuando hay múltiples candidatos
    con el mismo nombre.
    """
    with conn.cursor() as cur:
        cur.execute("""
            SELECT product_id, COUNT(*) AS n
            FROM simora_v2.fact_order_items
            WHERE product_id IS NOT NULL
            GROUP BY product_id
        """)
        return {str(r[0]): int(r[1]) for r in cur.fetchall()}


def build_name_index(products: list, usage: dict) -> dict:
    """
    Construye: norm(name) → product_id
    Prioridad: novalogic > legacy_mongo
    Desempate dentro del mismo source: mayor usage_count
    """
    # Temporalmente agrupamos por nombre normalizado
    candidates: dict[str, list] = defaultdict(list)
    for pid, name, source, ptype, cid, vval in products:
        key = norm(name)
        candidates[key].append((str(pid), source, usage.get(str(pid), 0)))

    result = {}
    for key, cands in candidates.items():
        # Preferir novalogic; si empate, mayor usage
        def sort_key(c):
            pid, src, cnt = c
            src_prio = 0 if src == "novalogic" else 1
            return (src_prio, -cnt)
        best = sorted(cands, key=sort_key)[0]
        result[key] = best[0]   # product_id ganador
    return result


def build_variant_index(products: list) -> dict:
    """
    Construye índice para ruta B:
    norm(variant_master_name) → { norm(variant_value) → product_id }
    """
    # Primero, mapa id → nombre para todos los productos
    id_to_name = {str(pid): name for pid, name, *_ in products}

    index: dict[str, dict] = defaultdict(dict)
    for pid, name, source, ptype, cid, vval in products:
        if ptype == "variant_instance" and cid and vval:
            master_name = id_to_name.get(str(cid), "")
            master_norm = norm(master_name)
            vval_norm   = norm(vval)
            if master_norm and vval_norm:
                # Si ya hay un candidato, guardar ambos (desempate luego)
                if vval_norm not in index[master_norm]:
                    index[master_norm][vval_norm] = str(pid)
    return index


def resolve_orphans(orphans, name_index, variant_index):
    """
    Resuelve cada huérfano con Ruta A o B.
    Retorna lista de (item_id, resolved_product_id, route).
    """
    resolved = []
    unresolved = []

    for iid, product_name, source_pid, unit_price, qty, total in orphans:
        pname = (product_name or "").strip()
        if not pname:
            unresolved.append((str(iid), pname, "empty_name"))
            continue

        # ── Ruta B: notación "Master - Variante" ──────────────────────────
        if " - " in pname:
            parts = pname.split(" - ", 1)
            base_norm  = norm(parts[0])
            vval_norm  = norm(parts[1])

            if base_norm in variant_index:
                vmap = variant_index[base_norm]
                if vval_norm in vmap:
                    resolved.append((str(iid), vmap[vval_norm], "B_variant"))
                    continue
                # Intento fuzzy: variant_value es prefijo del nombre de variante
                for stored_vval, vpid in vmap.items():
                    if stored_vval.startswith(vval_norm) or vval_norm.startswith(stored_vval):
                        resolved.append((str(iid), vpid, "B_variant_fuzzy"))
                        break
                else:
                    # No encontró variante específica — fallback a nombre completo
                    pass

        # ── Ruta A: coincidencia exacta por nombre completo ───────────────
        pnorm = norm(pname)
        if pnorm in name_index:
            resolved.append((str(iid), name_index[pnorm], "A_name_exact"))
            continue

        # ── Ruta A parcial: ignorar sufijos de mayorista comunes ──────────
        stripped = re.sub(
            r'\s*\(mayorist[ao]s?\s*X?\s*\d*\)|\s*\(x\d+\s+mayorist[ao]s?\)|\s*\(x\d+\)',
            '', pname, flags=re.IGNORECASE
        ).strip()
        snorm = norm(stripped)
        if snorm != pnorm and snorm in name_index:
            resolved.append((str(iid), name_index[snorm], "A_name_stripped"))
            continue

        unresolved.append((str(iid), pname, "no_match"))

    return resolved, unresolved


def run(dry_run: bool):
    conn = simora_db.get_conn()

    # ── Cargar datos ─────────────────────────────────────────────────────────
    print("Cargando huérfanos...")
    orphans = load_orphans(conn)
    print(f"  Huérfanos encontrados: {len(orphans):,}")

    if not orphans:
        print("No hay líneas huérfanas. Nada que hacer.")
        conn.close()
        return {"orphans": 0}

    print("\nCargando dim_products...")
    products = load_dim_products(conn)
    print(f"  Productos en dim: {len(products)}")

    print("\nCargando conteos de uso...")
    usage = build_usage_counts(conn)

    # ── Construir índices ────────────────────────────────────────────────────
    name_index    = build_name_index(products, usage)
    variant_index = build_variant_index(products)
    print(f"  Índice por nombre   : {len(name_index):,} entradas")
    print(f"  Índice de variantes : {sum(len(v) for v in variant_index.values()):,} entradas")

    # ── Resolver ─────────────────────────────────────────────────────────────
    resolved, unresolved = resolve_orphans(orphans, name_index, variant_index)

    # Conteos por ruta
    from collections import Counter
    route_counts = Counter(r for _, _, r in resolved)

    total_revenue_orphan = sum(
        float(total or 0)
        for _, _, _, _, _, total in orphans
    )
    resolved_ids = {iid for iid, _, _ in resolved}
    resolved_revenue = sum(
        float(total or 0)
        for iid, _, _, _, _, total in orphans
        if str(iid) in resolved_ids
    )

    print(f"\n=== RESOLUCIÓN ===")
    print(f"  Total huérfanos  : {len(orphans):,}")
    print(f"  Resueltos        : {len(resolved):,}")
    print(f"  Sin resolver     : {len(unresolved):,}")
    print(f"\n  Por ruta:")
    for route, n in sorted(route_counts.items()):
        print(f"    {route:<22} {n:>6,}")
    print(f"\n  Revenue cubierto : ${resolved_revenue:>20,.0f}")
    print(f"  Revenue perdido  : ${total_revenue_orphan - resolved_revenue:>20,.0f}")

    if unresolved:
        print(f"\n=== SIN RESOLVER ({len(unresolved)}) ===")
        by_reason = defaultdict(list)
        for iid, pname, reason in unresolved:
            by_reason[reason].append(pname)
        for reason, names in sorted(by_reason.items()):
            print(f"\n  [{reason}] — {len(names)} líneas:")
            for n in sorted(set(names))[:20]:
                print(f"    '{n}'")
            if len(set(names)) > 20:
                print(f"    ... (+{len(set(names))-20} distintos)")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        conn.close()
        return {
            "dry_run": True,
            "orphans": len(orphans),
            "resolved": len(resolved),
            "unresolved": len(unresolved),
            "routes": dict(route_counts),
        }

    # ── Actualizar fact_order_items ──────────────────────────────────────────
    print(f"\nActualizando fact_order_items...")
    updated = 0
    BATCH = 500

    with conn.cursor() as cur:
        for i in range(0, len(resolved), BATCH):
            batch = resolved[i:i + BATCH]
            for iid, pid, route in batch:
                cur.execute("""
                    UPDATE simora_v2.fact_order_items
                    SET product_id = %s::uuid
                    WHERE id = %s
                      AND product_id IS NULL
                """, [pid, iid])
                updated += cur.rowcount
            conn.commit()
            print(f"  ... {min(i + BATCH, len(resolved))}/{len(resolved)}")

    print(f"  Filas actualizadas: {updated:,}")

    # ── Estado post-fix ──────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) FILTER (WHERE product_id IS NULL)     AS still_orphan,
              COUNT(*) FILTER (WHERE product_id IS NOT NULL) AS linked,
              COUNT(*)                                        AS total,
              COALESCE(SUM(total) FILTER (WHERE product_id IS NULL), 0) AS orphan_revenue,
              COALESCE(SUM(total) FILTER (WHERE product_id IS NOT NULL), 0) AS linked_revenue
            FROM simora_v2.fact_order_items
        """)
        row = cur.fetchone()
        still, linked, total, orph_rev, link_rev = row
        pct = round(linked / total * 100, 1) if total else 0
        print(f"  Total líneas      : {int(total):>10,}")
        print(f"  Con product_id    : {int(linked):>10,}  ({pct}%)")
        print(f"  Sin product_id    : {int(still or 0):>10,}")
        print(f"  Revenue vinculado : ${int(link_rev):>20,}")
        print(f"  Revenue huérfano  : ${int(orph_rev):>20,}")

    # ── Cobertura por producto (top 20 recuperados) ──────────────────────────
    print("\n=== TOP 20 PRODUCTOS RECUPERADOS ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT dp.name, COUNT(foi.id) AS lineas,
                   COALESCE(SUM(foi.total), 0) AS revenue
            FROM simora_v2.fact_order_items foi
            JOIN simora_v2.dim_products dp ON dp.id = foi.product_id
            WHERE foi.id = ANY(%s::uuid[])
            GROUP BY dp.name
            ORDER BY revenue DESC
            LIMIT 20
        """, [[iid for iid, _, _ in resolved]])
        print(f"  {'Producto':<55} {'líneas':>7}  {'revenue':>16}")
        print("  " + "-" * 82)
        for row in cur.fetchall():
            rev = int(row[2]) if row[2] else 0
            print(f"  {str(row[0]):<55} {int(row[1]):>7,}  {rev:>16,}")

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
                "high",
                "Fix 15: product_id resuelto en fact_order_items huérfanos",
                (
                    f"Se resolvieron {updated:,} líneas huérfanas de {len(orphans):,} totales. "
                    f"Revenue recuperado: ${resolved_revenue:,.0f} de ${total_revenue_orphan:,.0f}. "
                    f"Rutas: {dict(route_counts)}. "
                    f"Sin resolver: {len(unresolved):,} líneas. "
                    f"Método: coincidencia exacta por nombre (ruta A) + "
                    f"notación 'Producto - Variante' (ruta B). "
                    f"Desempate: source=novalogic > legacy_mongo, luego mayor uso histórico."
                ),
                ["fix", "fact_order_items", "product_id", "orphan", "data_linkage"],
                "15_resolve_orphan_order_items.py",
                updated,
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "orphans": len(orphans),
        "resolved": len(resolved),
        "updated": updated,
        "unresolved": len(unresolved),
        "routes": dict(route_counts),
        "revenue_resolved": round(resolved_revenue, 0),
        "revenue_total_orphan": round(total_revenue_orphan, 0),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
