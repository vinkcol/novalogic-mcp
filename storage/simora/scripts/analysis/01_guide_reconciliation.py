"""
Análisis 01: Reconciliación de guías
=====================================
Cruza fact_guides (sistema Novalogic) con fact_courier_reports (Domiflash XLSX)
para detectar discrepancias en costos, estados de entrega y guías sin match.

Salida: JSON con secciones summary, unmatched_guides, unmatched_courier,
        cost_discrepancies, delivery_rate_by_month.

Uso:
  python 01_guide_reconciliation.py
  python 01_guide_reconciliation.py --format table
"""

import json
import sys
import os
import argparse
import psycopg2
import psycopg2.extras

DB_DSN = os.getenv(
    "SIMORA_DB_DSN",
    "host=localhost port=5433 dbname=novalogic_mcp user=novalogic password=novalogic_mcp_2024",
)

def q(conn, sql, params=None):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        if params:
            cur.execute(sql, params)
        else:
            cur.execute(sql)  # sin params → psycopg2 no interpreta %
        return [dict(r) for r in cur.fetchall()]

def run(conn) -> dict:
    # ── 1. RESUMEN GENERAL ────────────────────────────────────────
    # Reglas de calidad aplicadas al courier:
    #   a) Excluir entradas con sufijo -N (duplicados historicos)
    #   b) Para el match, exigir que report_date este dentro de
    #      90 dias del ship_date del sistema (evita falsos positivos
    #      por reutilizacion de numeros de guia entre legacy y novalogic)
    summary = q(conn, """
        WITH guides AS (
            SELECT guide_number, MIN(ship_date) AS ship_date
            FROM simora_v2.fact_guides
            WHERE guide_number IS NOT NULL AND guide_number LIKE 'MAG%'
            GROUP BY guide_number
        ),
        courier AS (
            SELECT DISTINCT guide_number FROM simora_v2.fact_courier_reports
            WHERE guide_number LIKE 'MAG%'
              AND guide_number !~ '-[0-9]+$'
        ),
        matched_with_date AS (
            SELECT DISTINCT fg.guide_number
            FROM simora_v2.fact_guides fg
            JOIN simora_v2.fact_courier_reports cr USING (guide_number)
            WHERE fg.guide_number LIKE 'MAG%'
              AND cr.guide_number !~ '-[0-9]+$'
              AND fg.ship_date IS NOT NULL
              AND cr.report_date BETWEEN fg.ship_date::date - INTERVAL '90 days'
                                     AND fg.ship_date::date + INTERVAL '180 days'
        )
        SELECT
            (SELECT COUNT(*) FROM guides)            AS total_guides_sistema,
            (SELECT COUNT(*) FROM courier)           AS total_guides_courier,
            (SELECT COUNT(*) FROM matched_with_date) AS matched,
            (SELECT COUNT(*) FROM guides g
               WHERE NOT EXISTS (SELECT 1 FROM matched_with_date m WHERE m.guide_number = g.guide_number)
            ) AS only_in_sistema,
            (SELECT COUNT(*) FROM courier c
               WHERE NOT EXISTS (SELECT 1 FROM matched_with_date m WHERE m.guide_number = c.guide_number)
            ) AS only_in_courier,
            -- Falsos positivos: match por guide_number pero fuera de ventana de fechas
            (SELECT COUNT(DISTINCT fg.guide_number)
               FROM simora_v2.fact_guides fg
               JOIN simora_v2.fact_courier_reports cr USING (guide_number)
               WHERE fg.guide_number LIKE 'MAG%'
                 AND cr.guide_number !~ '-[0-9]+$'
                 AND fg.ship_date IS NOT NULL
                 AND NOT (cr.report_date BETWEEN fg.ship_date::date - INTERVAL '90 days'
                                             AND fg.ship_date::date + INTERVAL '180 days')
            ) AS false_positives
    """)[0]

    match_pct = round(int(summary["matched"]) / int(summary["total_guides_sistema"]) * 100, 1)
    summary["match_pct"] = match_pct

    # ── 2. TASA DE ENTREGA POR MES (courier) ──────────────────────
    delivery_rate = q(conn, """
        SELECT
            TO_CHAR(report_date, 'YYYY-MM') AS month,
            COUNT(*) AS total,
            COUNT(*) FILTER (WHERE status ILIKE '%ENTREGADO%') AS delivered,
            COUNT(*) FILTER (WHERE status ILIKE '%DEVUELTO%' OR status ILIKE '%DEVOLUCION%') AS returned,
            COUNT(*) FILTER (WHERE status ILIKE '%PENDIENTE%' OR status ILIKE '%EN RUTA%') AS in_transit,
            ROUND(
                COUNT(*) FILTER (WHERE status ILIKE '%ENTREGADO%')::numeric
                / NULLIF(COUNT(*), 0) * 100, 1
            ) AS delivery_rate_pct
        FROM simora_v2.fact_courier_reports
        WHERE guide_number LIKE 'MAG%'
          AND guide_number !~ '-[0-9]+$'
        GROUP BY month
        ORDER BY month
    """)

    # ── 3. DISCREPANCIAS DE COSTO (donde ambos lados tienen valor) ─
    cost_discrepancies = q(conn, """
        SELECT
            cr.guide_number,
            cr.report_date,
            fg.shipping_cost   AS cost_sistema,
            cr.shipping_cost   AS cost_courier,
            ROUND(cr.shipping_cost - fg.shipping_cost, 0) AS diff,
            fg.destination_city AS city,
            cr.status
        FROM simora_v2.fact_courier_reports cr
        JOIN simora_v2.fact_guides fg USING (guide_number)
        WHERE cr.guide_number LIKE 'MAG%'
          AND cr.guide_number !~ '-[0-9]+$'
          AND fg.shipping_cost IS NOT NULL
          AND cr.shipping_cost IS NOT NULL
          AND ABS(cr.shipping_cost - fg.shipping_cost) > 500
        ORDER BY ABS(cr.shipping_cost - fg.shipping_cost) DESC
        LIMIT 50
    """)

    cost_summary = q(conn, """
        SELECT
            COUNT(*) AS guides_compared,
            ROUND(AVG(cr.shipping_cost - fg.shipping_cost), 0) AS avg_diff_cop,
            ROUND(SUM(cr.shipping_cost - fg.shipping_cost), 0) AS total_diff_cop,
            ROUND(SUM(cr.shipping_cost), 0) AS total_courier_cost,
            ROUND(SUM(fg.shipping_cost), 0) AS total_sistema_cost
        FROM simora_v2.fact_courier_reports cr
        JOIN simora_v2.fact_guides fg USING (guide_number)
        WHERE cr.guide_number LIKE 'MAG%'
          AND cr.guide_number !~ '-[0-9]+$'
          AND fg.shipping_cost IS NOT NULL
          AND cr.shipping_cost IS NOT NULL
    """)[0]

    # ── 4. GUÍAS EN SISTEMA SIN REPORTE COURIER (por período) ──────
    only_sistema = q(conn, """
        SELECT
            TO_CHAR(fg.ship_date, 'YYYY-MM') AS month,
            COUNT(*) AS count,
            fg.source
        FROM simora_v2.fact_guides fg
        WHERE fg.guide_number LIKE 'MAG%'
          AND NOT EXISTS (
              SELECT 1 FROM simora_v2.fact_courier_reports cr
              WHERE cr.guide_number = fg.guide_number
          )
          AND fg.ship_date IS NOT NULL
        GROUP BY month, fg.source
        ORDER BY month
    """)

    # ── 5. GUÍAS EN COURIER SIN SISTEMA (muestras) ─────────────────
    only_courier = q(conn, """
        SELECT
            cr.guide_number,
            cr.report_date,
            cr.destination,
            cr.status,
            cr.declared_value,
            cr.customer_name
        FROM simora_v2.fact_courier_reports cr
        WHERE cr.guide_number LIKE 'MAG%'
          AND cr.guide_number !~ '-[0-9]+$'
          AND NOT EXISTS (
              SELECT 1 FROM simora_v2.fact_guides fg
              WHERE fg.guide_number = cr.guide_number
          )
        ORDER BY cr.report_date DESC
        LIMIT 30
    """)

    # ── 6. ESTATUS DE ENTREGA POR FUENTE ───────────────────────────
    delivery_by_source = q(conn, """
        SELECT
            cr.status,
            COUNT(*) AS count,
            ROUND(COUNT(*)::numeric / SUM(COUNT(*)) OVER () * 100, 1) AS pct
        FROM simora_v2.fact_courier_reports cr
        WHERE cr.guide_number LIKE 'MAG%'
          AND cr.guide_number !~ '-[0-9]+$'
        GROUP BY cr.status
        ORDER BY count DESC
        LIMIT 15
    """)

    # ── 7. TOP CIUDADES POR VOLUMEN Y COSTO ───────────────────────
    top_cities = q(conn, """
        SELECT
            TRIM(cr.destination) AS city,
            COUNT(*) AS shipments,
            ROUND(AVG(cr.shipping_cost), 0) AS avg_flete_cop,
            ROUND(SUM(cr.shipping_cost), 0) AS total_flete_cop,
            ROUND(
                COUNT(*) FILTER (WHERE cr.status ILIKE '%ENTREGADO%')::numeric
                / NULLIF(COUNT(*), 0) * 100, 1
            ) AS delivery_pct
        FROM simora_v2.fact_courier_reports cr
        WHERE cr.guide_number LIKE 'MAG%'
          AND cr.guide_number !~ '-[0-9]+$'
          AND cr.destination IS NOT NULL
        GROUP BY TRIM(cr.destination)
        ORDER BY shipments DESC
        LIMIT 20
    """)

    return {
        "summary": summary,
        "delivery_rate_by_month": delivery_rate,
        "delivery_by_status": delivery_by_source,
        "cost_summary": cost_summary,
        "cost_discrepancies_top50": cost_discrepancies,
        "only_in_sistema_by_month": only_sistema,
        "only_in_courier_sample": only_courier,
        "top_cities": top_cities,
    }


def print_table(rows: list[dict], title: str = ""):
    if not rows:
        print(f"  (sin datos)")
        return
    if title:
        print(f"\n{'='*60}\n{title}\n{'='*60}")
    keys = list(rows[0].keys())
    widths = [max(len(str(r.get(k, ""))) for r in rows + [dict(zip(keys, keys))]) for k in keys]
    header = "  ".join(str(k).ljust(w) for k, w in zip(keys, widths))
    print(header)
    print("  ".join("-" * w for w in widths))
    for row in rows:
        print("  ".join(str(row.get(k, "")).ljust(w) for k, w in zip(keys, widths)))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--format", choices=["json", "table"], default="json")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_DSN)
    try:
        results = run(conn)
    finally:
        conn.close()

    if args.format == "table":
        s = results["summary"]
        print(f"\n{'='*60}")
        print(f"RECONCILIACION DE GUIAS - simora_v2")
        print(f"{'='*60}")
        print(f"  Guias en sistema:        {s['total_guides_sistema']:>8,}")
        print(f"  Guias en courier:        {s['total_guides_courier']:>8,}")
        print(f"  Matched (con ventana):   {s['matched']:>8,}  ({s['match_pct']}%)")
        print(f"  Solo en sistema:         {s['only_in_sistema']:>8,}")
        print(f"  Solo en courier:         {s['only_in_courier']:>8,}")
        print(f"  Falsos positivos:        {s['false_positives']:>8,}  (mismo numero, fecha incompatible)")

        cs = results["cost_summary"]
        print(f"\n  Costo sistema:      ${int(cs['total_sistema_cost'] or 0):>12,} COP")
        print(f"  Costo courier:      ${int(cs['total_courier_cost'] or 0):>12,} COP")
        print(f"  Diferencia total:   ${int(cs['total_diff_cop'] or 0):>12,} COP")
        print(f"  Diferencia promedio:${int(cs['avg_diff_cop'] or 0):>12,} COP / guía")

        print_table(results["delivery_rate_by_month"], "TASA DE ENTREGA POR MES")
        print_table(results["delivery_by_status"],     "ESTADOS DE ENTREGA (courier)")
        print_table(results["top_cities"],             "TOP 20 CIUDADES")
        print_table(results["only_in_sistema_by_month"], "GUÍAS EN SISTEMA SIN COURIER (por mes)")
    else:
        print(json.dumps(results, indent=2, default=str))
