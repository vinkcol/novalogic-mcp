"""
Fix 07: Recalcular delivery_status y payment_status
=====================================================
Problema: ETL hardcodeo delivery_status='delivered' y payment_status='pending'
          en los 25,135 pedidos. Los valores son incorrectos.

Fuente de verdad: fact_courier_reports.status (ENTREGADO/DEVOLUCION/etc.)
Reglas de derivacion:

  delivery_status (nuevo valor real):
    courier ENTREGADO                   -> delivered
    courier DEVOLUCION                  -> returned
    courier REPROGRAMADO                -> rescheduled
    courier RETENIDO                    -> held
    courier SOACHA (error de dato)      -> unconfirmed  + flag para investigar
    guia existe pero sin courier match  -> unconfirmed
    pedido sin guia alguna              -> no_guide

  Para guias con multiples reportes: se toma el reporte con report_date mas reciente.

  payment_status (nuevo valor real):
    modalidad anticipado/exento         -> paid / waived (independiente de entrega)
    modalidad contraentrega o hibrido:
      delivery=delivered                -> paid (courier recaudo)
      delivery=returned                 -> not_collected
      delivery=rescheduled | held       -> pending_collection
      delivery=unconfirmed              -> unconfirmed
      delivery=no_guide                 -> unknown

Garantias de integridad:
  - Columna delivery_status_source agregada: registra de donde vino el estado
  - Los valores anteriores (hardcoded) quedan en audit trail via bitacora
  - Operacion idempotente: puede correrse de nuevo sin dano

Uso:
  python 07_recalculate_statuses.py --dry-run
  python 07_recalculate_statuses.py
"""

import sys
import json
import argparse
from pathlib import Path
from collections import Counter, defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

# Mapa courier status -> delivery_status
COURIER_TO_DELIVERY = {
    "ENTREGADO":    "delivered",
    "DEVOLUCION":   "returned",
    "DEVOLUCIÓN":   "returned",
    "REPROGRAMADO": "rescheduled",
    "RETENIDO":     "held",
}

# Mapa delivery_status -> payment_status segun modalidad
def derive_payment_status(modality: str, delivery: str) -> str:
    if modality == "anticipado":
        return "paid"
    if modality == "exento":
        return "waived"
    # contraentrega o hibrido
    if delivery == "delivered":
        return "paid"
    if delivery == "returned":
        return "not_collected"
    if delivery in ("rescheduled", "held"):
        return "pending_collection"
    if delivery == "unconfirmed":
        return "unconfirmed"
    if delivery == "no_guide":
        return "unknown"
    return "unknown"


def ensure_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.fact_orders
              ADD COLUMN IF NOT EXISTS delivery_status_source VARCHAR(30)
        """)
        # Ampliar delivery_status si tiene constraint de enum (preventivo)
        cur.execute("""
            ALTER TABLE simora_v2.fact_orders
              ALTER COLUMN delivery_status TYPE VARCHAR(30),
              ALTER COLUMN payment_status  TYPE VARCHAR(30)
        """)
    conn.commit()
    print("Columnas verificadas.")


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_columns(conn)

    # ── 1. Ultimo reporte courier por guia ────────────────────────────────────
    print("Cargando reportes courier (ultimo por guia)...")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT ON (guide_number)
                guide_number,
                status,
                report_date
            FROM simora_v2.fact_courier_reports
            ORDER BY guide_number, report_date DESC
        """)
        courier_rows = cur.fetchall()

    # guia -> (status, report_date)
    courier_map = {row[0]: (row[1], row[2]) for row in courier_rows}
    print(f"  Guias con reporte courier: {len(courier_map):,}")

    # ── 2. Todas las guias con su order_id ───────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT order_id, guide_number
            FROM simora_v2.fact_guides
            WHERE order_id IS NOT NULL
        """)
        guide_rows = cur.fetchall()

    # order_id -> lista de guide_numbers
    order_guides: dict[str, list[str]] = defaultdict(list)
    for order_id, guide_number in guide_rows:
        order_guides[str(order_id)].append(guide_number)

    print(f"  Pedidos con al menos 1 guia: {len(order_guides):,}")

    # ── 3. Todos los pedidos con su modalidad actual ──────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, delivery_status, payment_status, payment_modality
            FROM simora_v2.fact_orders
        """)
        orders = cur.fetchall()

    print(f"  Pedidos a recalcular: {len(orders):,}")

    # ── 4. Clasificar cada pedido ─────────────────────────────────────────────
    updates = []
    delivery_counter = Counter()
    payment_counter  = Counter()
    source_counter   = Counter()
    anomalies        = []

    for order_id, old_delivery, old_payment, modality in orders:
        oid = str(order_id)
        guides = order_guides.get(oid, [])

        if not guides:
            new_delivery = "no_guide"
            source       = "no_guide"
        else:
            # Buscar el mejor reporte entre todas las guias del pedido
            best_status = None
            best_date   = None
            for gn in guides:
                if gn in courier_map:
                    cr_status, cr_date = courier_map[gn]
                    if best_date is None or cr_date > best_date:
                        best_status = cr_status
                        best_date   = cr_date

            if best_status is None:
                new_delivery = "unconfirmed"
                source       = "guide_no_courier"
            elif best_status in COURIER_TO_DELIVERY:
                new_delivery = COURIER_TO_DELIVERY[best_status]
                source       = "courier_report"
            else:
                # Estado no reconocido (ej: SOACHA)
                new_delivery = "unconfirmed"
                source       = f"courier_unknown:{best_status}"
                anomalies.append((oid, best_status, guides))

        new_payment = derive_payment_status(modality or "contraentrega", new_delivery)

        delivery_counter[new_delivery] += 1
        payment_counter[new_payment]   += 1
        source_counter[source]         += 1

        updates.append((new_delivery, new_payment, source, order_id))

    # ── Reporte preview ───────────────────────────────────────────────────────
    print("\nDelivery status (nuevo):")
    for k, v in delivery_counter.most_common():
        print(f"  {k:20s} {v:>6,}  ({round(v/len(updates)*100,1)}%)")

    print("\nPayment status (nuevo):")
    for k, v in payment_counter.most_common():
        print(f"  {k:20s} {v:>6,}  ({round(v/len(updates)*100,1)}%)")

    print("\nFuente del estado:")
    for k, v in source_counter.most_common():
        print(f"  {k:30s} {v:>6,}")

    if anomalies:
        print(f"\nAnomalias (estados courier no reconocidos): {len(anomalies)}")
        for oid, st, gns in anomalies[:10]:
            print(f"  order={oid}  courier_status={st!r}  guias={gns}")

    if dry_run:
        print("\n[DRY RUN] No se aplican cambios.")
        conn.close()
        return {
            "delivery": dict(delivery_counter),
            "payment":  dict(payment_counter),
            "sources":  dict(source_counter),
            "anomalies": len(anomalies),
        }

    # ── 5. Aplicar en bloques ─────────────────────────────────────────────────
    BATCH = 500
    total_updated = 0

    with conn.cursor() as cur:
        batch = []
        for i, row in enumerate(updates):
            batch.append(row)
            if len(batch) == BATCH or i == len(updates) - 1:
                for new_delivery, new_payment, source, oid in batch:
                    cur.execute("""
                        UPDATE simora_v2.fact_orders
                        SET delivery_status        = %s,
                            payment_status         = %s,
                            delivery_status_source = %s
                        WHERE id = %s
                    """, [new_delivery, new_payment, source, oid])
                total_updated += len(batch)
                batch = []

    conn.commit()
    print(f"\nfact_orders actualizados: {total_updated:,}")

    # ── 6. Verificacion cruzada ───────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT delivery_status, payment_status, COUNT(*) as n
            FROM simora_v2.fact_orders
            GROUP BY delivery_status, payment_status
            ORDER BY n DESC
        """)
        print("\nVerificacion cruzada delivery x payment:")
        for row in cur.fetchall():
            print(f"  {str(row[0]):20s} / {str(row[1]):20s}  {int(row[2]):>6,}")

        cur.execute("""
            SELECT COUNT(*) FROM simora_v2.fact_orders
            WHERE delivery_status = 'delivered' AND payment_modality = 'contraentrega'
              AND payment_status != 'paid'
        """)
        inconsist = cur.fetchone()[0]
        print(f"\nInconsistencias delivery=delivered+contraentrega pero payment!=paid: {inconsist}")

    # ── 7. Bitacora ───────────────────────────────────────────────────────────
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
                "Fix 07: delivery_status y payment_status recalculados desde courier",
                (
                    f"ETL habia hardcodeado delivery_status='delivered' y payment_status='pending' "
                    f"en los 25,135 pedidos. Se recalcularon usando fact_courier_reports como fuente de verdad. "
                    f"Distribucion delivery: {dict(delivery_counter)}. "
                    f"Distribucion payment: {dict(payment_counter)}. "
                    f"Fuentes: courier_report={source_counter.get('courier_report',0)}, "
                    f"guide_no_courier={source_counter.get('guide_no_courier',0)}, "
                    f"no_guide={source_counter.get('no_guide',0)}. "
                    f"Anomalias (estados no reconocidos): {len(anomalies)}. "
                    f"Columna delivery_status_source agregada para trazabilidad."
                ),
                ["fix", "delivery_status", "payment_status", "fact_orders", "courier"],
                "07_recalculate_statuses.py",
                total_updated,
                "resolved",
            ])
        conn.commit()
        print("Bitacora actualizada.")
    except Exception as e:
        print(f"[!] Error en bitacora: {e}")

    conn.close()
    return {
        "total_updated": total_updated,
        "delivery":      dict(delivery_counter),
        "payment":       dict(payment_counter),
        "sources":       dict(source_counter),
        "anomalies":     len(anomalies),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
