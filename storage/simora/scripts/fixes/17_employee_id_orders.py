"""
Fix 17: dim_employee_id en fact_orders sin vendedor asignado
============================================================
2,237 pedidos no tienen dim_employee_id:
  - 2,231 legacy_mongo con seller_id → dim_sellers.id
  - 6 novalogic sin seller_id → no resolvibles

Estrategia:
  1. Construir mapa dim_sellers.id → dim_employees.id por coincidencia
     exacta de nombre (case-insensitive, sin tildes).
  2. Para el caso no resuelto por nombre exacto, intentar coincidencia
     por máximo overlap de tokens (maneja typos leves como Yuri/Yury).
  3. Actualizar fact_orders.dim_employee_id usando seller_id como puente.

Uso:
  python 17_employee_id_orders.py --dry-run
  python 17_employee_id_orders.py
"""

import sys
import json
import argparse
import unicodedata
from pathlib import Path
from collections import Counter

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def norm(s: str) -> str:
    s = str(s or "").lower().strip()
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")


def token_overlap(a: str, b: str) -> float:
    """Fracción de tokens compartidos entre dos nombres."""
    ta = set(norm(a).split())
    tb = set(norm(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / max(len(ta), len(tb))


def build_seller_to_employee_map(sellers: list, employees: list) -> dict:
    """
    sellers  : [(id, full_name), ...]
    employees: [(id, canonical_name), ...]
    Retorna: {seller_id → employee_id}
    """
    emp_by_norm = {norm(name): str(eid) for eid, name in employees}
    emp_list    = [(str(eid), name) for eid, name in employees]

    mapping = {}
    unmatched = []

    # Pase 1: coincidencia exacta por nombre normalizado
    for sid, sname in sellers:
        sn = norm(sname)
        if sn in emp_by_norm:
            mapping[str(sid)] = emp_by_norm[sn]
        else:
            unmatched.append((str(sid), sname))

    # Pase 2: máximo overlap de tokens para no resueltos
    for sid, sname in unmatched:
        best_score = 0.0
        best_eid   = None
        for eid, ename in emp_list:
            score = token_overlap(sname, ename)
            if score > best_score:
                best_score = score
                best_eid   = eid
        if best_eid and best_score >= 0.6:
            mapping[sid] = best_eid
            print(f"  [fuzzy] '{sname}' → '{dict(emp_list).get(best_eid, '?')}' (score={best_score:.2f})")
        else:
            print(f"  [sin match] '{sname}'")

    return mapping


def run(dry_run: bool):
    conn = simora_db.get_conn()

    # ── Cargar dimensiones ───────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("SELECT id, full_name FROM simora_v2.dim_sellers")
        sellers = cur.fetchall()

        cur.execute("SELECT id, canonical_name FROM simora_v2.dim_employees")
        employees = cur.fetchall()

    print(f"dim_sellers  : {len(sellers)}")
    print(f"dim_employees: {len(employees)}")

    # ── Construir mapa seller → employee ────────────────────────────────────
    print("\nConstruyendo mapa seller → employee:")
    seller_to_emp = build_seller_to_employee_map(sellers, employees)
    print(f"\n  Sellers resueltos: {len(seller_to_emp)} / {len(sellers)}")

    # ── Cargar órdenes sin dim_employee_id ───────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, source::text, seller_id
            FROM simora_v2.fact_orders
            WHERE dim_employee_id IS NULL
        """)
        orphan_orders = cur.fetchall()
    print(f"\nÓrdenes sin dim_employee_id: {len(orphan_orders):,}")

    # ── Resolver ─────────────────────────────────────────────────────────────
    resolved   = []  # (order_id, employee_id)
    unresolved = []

    for oid, source, seller_id in orphan_orders:
        if seller_id and str(seller_id) in seller_to_emp:
            resolved.append((str(oid), seller_to_emp[str(seller_id)]))
        else:
            unresolved.append((str(oid), source, str(seller_id) if seller_id else None))

    print(f"\n  Resueltos  : {len(resolved):,}")
    print(f"  Sin resolver: {len(unresolved):,}")
    if unresolved:
        print(f"\n  Detalle sin resolver:")
        for oid, src, sid in unresolved[:10]:
            print(f"    order={oid[:8]}... source={src}  seller_id={sid}")

    # Distribución por empleado
    emp_count = Counter(eid for _, eid in resolved)
    emp_names = {str(eid): name for eid, name in employees}
    print(f"\n=== DISTRIBUCIÓN POR VENDEDOR ===")
    for eid, n in emp_count.most_common():
        print(f"  {emp_names.get(eid, eid):<35} {n:>6,} órdenes")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        conn.close()
        return {
            "dry_run": True,
            "orphans": len(orphan_orders),
            "resolved": len(resolved),
            "unresolved": len(unresolved),
        }

    # ── Actualizar fact_orders ────────────────────────────────────────────────
    print(f"\nActualizando fact_orders.dim_employee_id...")
    updated = 0
    BATCH   = 500

    with conn.cursor() as cur:
        for i in range(0, len(resolved), BATCH):
            batch = resolved[i:i + BATCH]
            for oid, eid in batch:
                cur.execute("""
                    UPDATE simora_v2.fact_orders
                    SET dim_employee_id = %s::uuid
                    WHERE id = %s
                      AND dim_employee_id IS NULL
                """, [eid, oid])
                updated += cur.rowcount
        conn.commit()

    print(f"  Filas actualizadas: {updated:,}")

    # ── Estado final ─────────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*)                                            AS total,
              COUNT(*) FILTER (WHERE dim_employee_id IS NOT NULL) AS con_emp,
              COUNT(*) FILTER (WHERE dim_employee_id IS NULL)     AS sin_emp
            FROM simora_v2.fact_orders
        """)
        r = cur.fetchone()
        pct = round(int(r[1]) / int(r[0]) * 100, 1)
        print(f"  Total órdenes  : {int(r[0]):>8,}")
        print(f"  Con vendedor   : {int(r[1]):>8,}  ({pct}%)")
        print(f"  Sin vendedor   : {int(r[2]):>8,}")

    print("\n=== VENTAS POR VENDEDOR ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT de.canonical_name,
                   COUNT(fo.id)            AS pedidos,
                   COALESCE(SUM(fo.total),0) AS revenue,
                   COUNT(*) FILTER (WHERE fo.delivery_status = 'delivered') AS entregados
            FROM simora_v2.fact_orders fo
            JOIN simora_v2.dim_employees de ON de.id = fo.dim_employee_id
            GROUP BY de.canonical_name
            ORDER BY revenue DESC
        """)
        print(f"  {'Vendedor':<35} {'pedidos':>8}  {'entregados':>10}  {'revenue':>16}")
        print("  " + "-" * 75)
        for r in cur.fetchall():
            print(f"  {str(r[0]):<35} {int(r[1]):>8,}  {int(r[3] or 0):>10,}  ${int(r[2]):>15,}")

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
                "Fix 17: dim_employee_id resuelto en fact_orders",
                (
                    f"Se resolvieron {updated:,} pedidos sin vendedor. "
                    f"Método: dim_sellers.full_name ≈ dim_employees.canonical_name "
                    f"(normalización unicode + fallback fuzzy por token overlap). "
                    f"Sin resolver: {len(unresolved):,} (novalogic sin seller_id). "
                    f"Distribución: {dict(emp_count.most_common(3))}."
                ),
                ["fix", "orders", "employee", "seller", "attribution"],
                "17_employee_id_orders.py",
                updated,
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "orphans": len(orphan_orders),
        "resolved": len(resolved),
        "updated": updated,
        "unresolved": len(unresolved),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
