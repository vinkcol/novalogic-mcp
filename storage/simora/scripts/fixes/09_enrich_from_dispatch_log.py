"""
Fix 09: Enriquecimiento de fact_orders desde fact_dispatch_log
==============================================================
Objetivo: cruzar las planillas diarias de Domiflash con los pedidos
          para agregar trazabilidad de despacho y refinar estados.

Acciones:
  1. Agregar columna dispatch_date a fact_orders.
  2. Poblar dispatch_date usando dos rutas de match:
       a) source_id = mongo_id  (pedidos legacy MongoDB)
       b) guide_number → fact_guides → order_id  (todos los pedidos con guia)
     Se usa la fecha de despacho más temprana (primer envío a mensajería).
  3. Sub-clasificar unconfirmed con razon no_courier_coverage:
       Si el pedido SÍ aparece en dispatch_log → reason = 'dispatched_no_outcome_report'
         (se despachó pero Domiflash nunca reportó resultado)
       Si NO aparece → reason = 'no_courier_coverage' (sin datos en ninguna fuente)
  4. Registrar en bitacora.

Garantias:
  - Nunca modifica datos originales, solo agrega columna y refina reason.
  - Idempotente.

Uso:
  python 09_enrich_from_dispatch_log.py --dry-run
  python 09_enrich_from_dispatch_log.py
"""

import sys
import json
import argparse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def ensure_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.fact_orders
              ADD COLUMN IF NOT EXISTS dispatch_date DATE
        """)
    conn.commit()


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_columns(conn)

    # ── 1. Construir mapa order_id → dispatch_date más temprana ──────────────
    print("Construyendo mapa order_id → dispatch_date...")

    with conn.cursor() as cur:
        # Ruta A: source_id = mongo_id (pedidos legacy MongoDB)
        cur.execute("""
            SELECT fo.id, MIN(dl.dispatch_date)
            FROM simora_v2.fact_dispatch_log dl
            JOIN simora_v2.fact_orders fo ON fo.source_id = dl.mongo_id
            WHERE dl.dispatch_date IS NOT NULL
            GROUP BY fo.id
        """)
        dispatch_map = {str(r[0]): r[1] for r in cur.fetchall()}
        print(f"  Via source_id=mongo_id: {len(dispatch_map):,} pedidos")

        # Ruta B: guide_number → fact_guides → order_id
        cur.execute("""
            SELECT fo.id, MIN(dl.dispatch_date)
            FROM simora_v2.fact_dispatch_log dl
            JOIN simora_v2.fact_guides fg ON fg.guide_number = dl.guide_number
            JOIN simora_v2.fact_orders fo ON fo.id = fg.order_id
            WHERE dl.dispatch_date IS NOT NULL
            GROUP BY fo.id
        """)
        for oid, ddate in cur.fetchall():
            key = str(oid)
            if key not in dispatch_map or (ddate and ddate < dispatch_map[key]):
                dispatch_map[key] = ddate

    print(f"  Total pedidos con dispatch_date: {len(dispatch_map):,}")

    # ── 2. Poblar dispatch_date ───────────────────────────────────────────────
    print(f"\n{'[DRY RUN] ' if dry_run else ''}Actualizando dispatch_date...")

    if not dry_run:
        BATCH = 500
        items = list(dispatch_map.items())
        updated_dispatch = 0
        with conn.cursor() as cur:
            for i in range(0, len(items), BATCH):
                batch = items[i:i + BATCH]
                for oid, ddate in batch:
                    cur.execute("""
                        UPDATE simora_v2.fact_orders
                        SET dispatch_date = %s
                        WHERE id = %s AND (dispatch_date IS NULL OR dispatch_date > %s)
                    """, [ddate, oid, ddate])
                    updated_dispatch += cur.rowcount
        conn.commit()
        print(f"  dispatch_date actualizado en {updated_dispatch:,} pedidos")
    else:
        print(f"  [DRY RUN] Se actualizarian {len(dispatch_map):,} pedidos")

    # ── 3. Identificar unconfirmed que sí aparecen en dispatch_log ───────────
    print("\nAnalizando unconfirmed en dispatch_log...")

    with conn.cursor() as cur:
        # unconfirmed con no_courier_coverage
        cur.execute("""
            SELECT fo.id
            FROM simora_v2.fact_orders fo
            WHERE fo.delivery_status = 'unconfirmed'
              AND fo.unconfirmed_reason = 'no_courier_coverage'
        """)
        unconfirmed_ids = {str(r[0]) for r in cur.fetchall()}
    print(f"  unconfirmed con no_courier_coverage: {len(unconfirmed_ids):,}")

    # Cuáles están en dispatch_log (via cualquiera de las dos rutas)
    dispatched_unconfirmed = unconfirmed_ids & set(dispatch_map.keys())
    not_dispatched_unconfirmed = unconfirmed_ids - dispatched_unconfirmed

    print(f"  -> Sí aparecen en dispatch_log: {len(dispatched_unconfirmed):,}  (dispatched_no_outcome_report)")
    print(f"  -> NO aparecen en dispatch_log: {len(not_dispatched_unconfirmed):,}  (no_courier_coverage — sin dato en ninguna fuente)")

    if not dry_run and dispatched_unconfirmed:
        BATCH = 500
        items = list(dispatched_unconfirmed)
        updated_reason = 0
        with conn.cursor() as cur:
            for i in range(0, len(items), BATCH):
                batch = items[i:i + BATCH]
                cur.execute("""
                    UPDATE simora_v2.fact_orders
                    SET unconfirmed_reason = 'dispatched_no_outcome_report'
                    WHERE id = ANY(%s::uuid[])
                      AND unconfirmed_reason = 'no_courier_coverage'
                """, [batch])
                updated_reason += cur.rowcount
        conn.commit()
        print(f"  unconfirmed_reason actualizado: {updated_reason:,}")

    # ── 4. Estado final ───────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COUNT(*) FILTER (WHERE dispatch_date IS NOT NULL) AS with_dispatch_date,
              COUNT(*) FILTER (WHERE dispatch_date IS NULL) AS without_dispatch_date,
              COUNT(*) AS total
            FROM simora_v2.fact_orders
        """)
        r = cur.fetchone()
        print(f"Con dispatch_date    : {r[0]:,} / {r[2]:,} ({round(r[0]/r[2]*100,1)}%)")
        print(f"Sin dispatch_date    : {r[1]:,} / {r[2]:,}")

        cur.execute("""
            SELECT unconfirmed_reason, COUNT(*) n
            FROM simora_v2.fact_orders
            WHERE unconfirmed_reason IS NOT NULL
            GROUP BY unconfirmed_reason ORDER BY n DESC
        """)
        print("\nunconfirmed_reason distribution:")
        for row in cur.fetchall():
            print(f"  {str(row[0]):40s} {int(row[1]):,}")

        cur.execute("""
            SELECT delivery_status, COUNT(*) n,
                   COUNT(*) FILTER (WHERE dispatch_date IS NOT NULL) dispatched
            FROM simora_v2.fact_orders
            GROUP BY delivery_status ORDER BY n DESC
        """)
        print("\ndelivery_status × dispatch_date coverage:")
        for row in cur.fetchall():
            pct = round(row[2]/row[1]*100,1) if row[1] else 0
            print(f"  {str(row[0]):22s} total={int(row[1]):>6,}  dispatched={int(row[2]):>6,} ({pct}%)")

    # ── 5. Bitacora ───────────────────────────────────────────────────────────
    if not dry_run:
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
                    "Fix 09: dispatch_date y unconfirmed_reason enriquecidos desde fact_dispatch_log",
                    (
                        f"Cruce fact_dispatch_log × fact_orders. "
                        f"dispatch_date poblado en {len(dispatch_map):,} pedidos "
                        f"(via source_id=mongo_id + guide_number→fact_guides). "
                        f"unconfirmed sub-clasificados: "
                        f"{len(dispatched_unconfirmed):,} → dispatched_no_outcome_report, "
                        f"{len(not_dispatched_unconfirmed):,} mantienen no_courier_coverage."
                    ),
                    ["fix", "dispatch_log", "dispatch_date", "unconfirmed_reason"],
                    "09_enrich_from_dispatch_log.py",
                    len(dispatch_map) + len(dispatched_unconfirmed),
                    "resolved",
                ])
            conn.commit()
            print("\nBitacora actualizada.")
        except Exception as e:
            print(f"\n[!] Error en bitacora: {e}")

    conn.close()
    return {
        "orders_with_dispatch_date": len(dispatch_map),
        "dispatched_unconfirmed":    len(dispatched_unconfirmed),
        "no_data_unconfirmed":       len(not_dispatched_unconfirmed),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
