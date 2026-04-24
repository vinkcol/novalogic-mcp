"""
Fix 08: Refinamiento de estados y correcciones puntuales
=========================================================
Objetivo: mejorar la precision de delivery_status y payment_status
          resolviendo los casos especiales identificados en Fix 07.

Acciones:
  1. Corregir SOACHA en fact_courier_reports
       guide MAG42130: status='SOACHA' es error de captura (ciudad en columna estado).
       Destination=BOGOTA, declared_value=28500 — sin evidencia de devolucion.
       Correccion: status -> 'ENTREGADO' con nota en descripcion.

  2. Sub-clasificar 'unconfirmed' en dos categorias mas precisas:
       pending_dispatch  -> pedidos novalogic recientes (< 60 dias)
                           sin reporte courier aun. Estado ESPERADO, no anomalia.
       unconfirmed       -> pedidos legacy sin cobertura en reportes courier.
                           Cobertura insuficiente del periodo — no hay dato disponible.

  3. Recalcular payment_status para los ordenes afectados.

  4. Agregar columna unconfirmed_reason para trazabilidad.

Garantias:
  - El valor original de fact_courier_reports.status se respalda en descripcion
    antes de modificarlo.
  - Ninguna fila se elimina.
  - Idempotente.

Uso:
  python 08_refine_statuses.py --dry-run
  python 08_refine_statuses.py
"""

import sys
import json
import argparse
from datetime import datetime, timezone, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

# Umbral: pedidos novalogic mas recientes que esto se consideran pending_dispatch
PENDING_DISPATCH_DAYS = 60

def derive_payment_status(modality: str, delivery: str) -> str:
    if modality == "anticipado":
        return "paid"
    if modality == "exento":
        return "waived"
    if delivery == "delivered":
        return "paid"
    if delivery == "returned":
        return "not_collected"
    if delivery in ("rescheduled", "held"):
        return "pending_collection"
    if delivery in ("unconfirmed", "pending_dispatch"):
        return "unconfirmed"
    if delivery == "no_guide":
        return "unknown"
    return "unknown"


def ensure_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.fact_orders
              ADD COLUMN IF NOT EXISTS unconfirmed_reason VARCHAR(50)
        """)
    conn.commit()


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_columns(conn)

    now = datetime.now(tz=timezone.utc)
    cutoff = now - timedelta(days=PENDING_DISPATCH_DAYS)

    # ── 1. Corregir SOACHA en fact_courier_reports ────────────────────────────
    print("=== ACCION 1: Correccion SOACHA en fact_courier_reports ===")

    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, guide_number, status, destination, declared_value,
                   report_date, description
            FROM simora_v2.fact_courier_reports
            WHERE status NOT IN (
              'ENTREGADO','DEVOLUCION','DEVOLUCIÓN',
              'REPROGRAMADO','RETENIDO'
            )
        """)
        bad_status_rows = cur.fetchall()

    print(f"  Filas con estado no reconocido: {len(bad_status_rows)}")
    for row in bad_status_rows:
        print(f"  id={row[0]}  guia={row[1]}  status={row[2]!r}  dest={row[3]}  valor={row[4]}")

    soacha_fixed = 0
    if not dry_run:
        with conn.cursor() as cur:
            for row in bad_status_rows:
                rid, guide, status, dest, val, rdate, desc = row
                nota = f"[CORRECCION Fix08] status original='{status}' era error de captura (ciudad en columna estado). Corregido a ENTREGADO por ausencia de evidencia de devolucion. dest={dest} valor={val}."
                cur.execute("""
                    UPDATE simora_v2.fact_courier_reports
                    SET status      = 'ENTREGADO',
                        description = %s
                    WHERE id = %s
                """, [nota, rid])
                soacha_fixed += 1
        conn.commit()
        print(f"  Corregidos: {soacha_fixed}")
    else:
        print(f"  [DRY RUN] Se corregiran: {len(bad_status_rows)}")

    # ── 2. Re-mapear los pedidos afectados por la correccion SOACHA ──────────
    # (el order_id cuyo guide_number = MAG42130 debe pasar a delivered)
    print("\n=== ACCION 2: Re-calcular pedido afectado por SOACHA ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT fo.id, fo.payment_modality
            FROM simora_v2.fact_orders fo
            JOIN simora_v2.fact_guides fg ON fg.order_id = fo.id
            WHERE fg.guide_number = 'MAG42130'
        """)
        soacha_orders = cur.fetchall()

    print(f"  Pedidos a actualizar: {len(soacha_orders)}")
    if not dry_run and soacha_orders:
        with conn.cursor() as cur:
            for oid, modality in soacha_orders:
                new_pay = derive_payment_status(modality or "contraentrega", "delivered")
                cur.execute("""
                    UPDATE simora_v2.fact_orders
                    SET delivery_status        = 'delivered',
                        payment_status         = %s,
                        delivery_status_source = 'courier_report_corrected',
                        unconfirmed_reason     = NULL
                    WHERE id = %s
                """, [new_pay, oid])
        conn.commit()
        print("  Actualizado a delivered.")

    # ── 3. Sub-clasificar 'unconfirmed' ──────────────────────────────────────
    print("\n=== ACCION 3: Sub-clasificar unconfirmed ===")

    with conn.cursor() as cur:
        cur.execute("""
            SELECT fo.id, fo.source, fo.order_date, fo.payment_modality
            FROM simora_v2.fact_orders fo
            WHERE fo.delivery_status = 'unconfirmed'
        """)
        unconfirmed_orders = cur.fetchall()

    print(f"  Total unconfirmed: {len(unconfirmed_orders):,}")

    pending_dispatch_ids = []
    unconfirmed_no_data  = []

    for oid, source, order_date, modality in unconfirmed_orders:
        if source == "novalogic" and order_date and order_date > cutoff:
            pending_dispatch_ids.append((oid, modality))
        else:
            unconfirmed_no_data.append((oid, modality))

    print(f"  -> pending_dispatch (novalogic < {PENDING_DISPATCH_DAYS}d): {len(pending_dispatch_ids):,}")
    print(f"  -> unconfirmed (legacy sin cobertura courier):               {len(unconfirmed_no_data):,}")

    if not dry_run:
        with conn.cursor() as cur:
            # pending_dispatch
            for oid, modality in pending_dispatch_ids:
                new_pay = derive_payment_status(modality or "contraentrega", "pending_dispatch")
                cur.execute("""
                    UPDATE simora_v2.fact_orders
                    SET delivery_status    = 'pending_dispatch',
                        payment_status     = %s,
                        unconfirmed_reason = 'recent_novalogic_no_report'
                    WHERE id = %s
                """, [new_pay, oid])

            # unconfirmed con razon documentada
            for oid, modality in unconfirmed_no_data:
                cur.execute("""
                    UPDATE simora_v2.fact_orders
                    SET unconfirmed_reason = 'no_courier_coverage'
                    WHERE id = %s
                """, [oid])

        conn.commit()
        print("  Sub-clasificacion aplicada.")

    # ── 4. Estado final ───────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT delivery_status, COUNT(*) as n,
                   ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),1) as pct
            FROM simora_v2.fact_orders
            GROUP BY delivery_status
            ORDER BY n DESC
        """)
        delivery_dist = cur.fetchall()

        print("delivery_status:")
        for row in delivery_dist:
            print(f"  {str(row[0]):22s} {int(row[1]):>6,}  ({row[2]}%)")

        cur.execute("""
            SELECT payment_status, COUNT(*) as n,
                   ROUND(COUNT(*)*100.0/SUM(COUNT(*)) OVER(),1) as pct
            FROM simora_v2.fact_orders
            GROUP BY payment_status
            ORDER BY n DESC
        """)
        print("\npayment_status:")
        for row in cur.fetchall():
            print(f"  {str(row[0]):22s} {int(row[1]):>6,}  ({row[2]}%)")

        cur.execute("""
            SELECT unconfirmed_reason, COUNT(*) as n
            FROM simora_v2.fact_orders
            WHERE unconfirmed_reason IS NOT NULL
            GROUP BY unconfirmed_reason
            ORDER BY n DESC
        """)
        print("\nunconfirmed_reason:")
        for row in cur.fetchall():
            print(f"  {str(row[0]):35s} {int(row[1]):>6,}")

    # ── 5. Bitacora ───────────────────────────────────────────────────────────
    if not dry_run:
        try:
            delivery_dict = {str(r[0]): int(r[1]) for r in delivery_dist}
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
                    "Fix 08: Refinamiento de estados — SOACHA, pending_dispatch, unconfirmed_reason",
                    (
                        f"1. SOACHA corregido: {soacha_fixed} fila(s) en fact_courier_reports con status invalido "
                        f"cambiadas a ENTREGADO (valor original preservado en description). "
                        f"2. Sub-clasificacion unconfirmed: "
                        f"{len(pending_dispatch_ids)} -> pending_dispatch (novalogic reciente sin reporte aun), "
                        f"{len(unconfirmed_no_data)} -> unconfirmed con reason=no_courier_coverage (legacy sin datos courier). "
                        f"3. Columna unconfirmed_reason agregada para trazabilidad. "
                        f"Estado final delivery: {delivery_dict}."
                    ),
                    ["fix", "delivery_status", "soacha", "pending_dispatch", "unconfirmed"],
                    "08_refine_statuses.py",
                    len(pending_dispatch_ids) + len(unconfirmed_no_data) + soacha_fixed,
                    "resolved",
                ])
            conn.commit()
            print("\nBitacora actualizada.")
        except Exception as e:
            print(f"\n[!] Error en bitacora: {e}")

    conn.close()

    result = {
        "soacha_fixed":        soacha_fixed if not dry_run else len(bad_status_rows),
        "pending_dispatch":    len(pending_dispatch_ids),
        "unconfirmed_no_data": len(unconfirmed_no_data),
    }
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
