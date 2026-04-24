"""
Agente de Anomalías Contables — simora_v2
==========================================
Ejecuta un conjunto de checks sistemáticos sobre los datos consolidados
y produce un reporte clasificado por severidad (CRITICAL / WARNING / INFO).

Categorías de checks:
  A. Integridad de datos (nulos, ceros, duplicados)
  B. Reconciliación guías vs courier
  C. Anomalías financieras (outliers, gaps, inconsistencias)
  D. Sellers / atribución de ventas
  E. Cobertura temporal (meses sin datos)

Uso:
  python 02_accounting_anomaly_agent.py
  python 02_accounting_anomaly_agent.py --min-severity WARNING
  python 02_accounting_anomaly_agent.py --format json
"""

import argparse
import json
import os
import sys
from datetime import date
from dataclasses import dataclass, field, asdict
from typing import Literal

import psycopg2
import psycopg2.extras

DB_DSN = os.getenv(
    "SIMORA_DB_DSN",
    "host=localhost port=5433 dbname=novalogic_mcp user=novalogic password=novalogic_mcp_2024",
)

Severity = Literal["CRITICAL", "WARNING", "INFO"]

@dataclass
class Anomaly:
    check_id:    str
    category:    str
    severity:    Severity
    title:       str
    detail:      str
    count:       int  = 0
    amount_cop:  float = 0.0
    rows:        list = field(default_factory=list)

def q(conn, sql):
    with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql)
        return [dict(r) for r in cur.fetchall()]

def q1(conn, sql):
    rows = q(conn, sql)
    return rows[0] if rows else {}

# ─── CHECKS ───────────────────────────────────────────────────────────────────

def check_orders_sin_total(conn) -> Anomaly | None:
    r = q1(conn, """
        SELECT COUNT(*) AS n, array_agg(tracking_code ORDER BY order_date DESC) AS codes
        FROM simora_v2.fact_orders
        WHERE total IS NULL OR total <= 0
    """)
    n = int(r.get("n", 0))
    if n == 0:
        return None
    return Anomaly(
        check_id="A01", category="Integridad", severity="CRITICAL",
        title="Pedidos con total nulo o cero",
        detail=f"{n} pedido(s) sin valor total registrado — no pueden auditarse ni conciliarse.",
        count=n, rows=(r.get("codes") or [])[:10],
    )

def check_orders_sin_guia(conn) -> Anomaly | None:
    r = q1(conn, """
        SELECT COUNT(*) AS n,
               ROUND(SUM(total),0) AS revenue_huerfano
        FROM simora_v2.fact_orders
        WHERE (guide_number IS NULL OR guide_number = '')
          AND total > 0
    """)
    n = int(r.get("n") or 0)
    if n == 0:
        return None
    return Anomaly(
        check_id="A02", category="Integridad", severity="WARNING",
        title="Pedidos sin número de guía",
        detail=f"{n} pedido(s) con revenue real pero sin guía asignada — no pueden rastrearse.",
        count=n, amount_cop=float(r.get("revenue_huerfano") or 0),
    )

def check_duplicados_mismo_dia(conn) -> Anomaly | None:
    r = q1(conn, """
        SELECT COUNT(*) AS n FROM (
            SELECT customer_id, total, DATE(order_date), COUNT(*) AS c
            FROM simora_v2.fact_orders
            WHERE customer_id IS NOT NULL AND total > 0
            GROUP BY customer_id, total, DATE(order_date)
            HAVING COUNT(*) > 1
        ) sub
    """)
    n = int(r.get("n") or 0)
    if n == 0:
        return None
    rows = q(conn, """
        SELECT o.tracking_code, c.full_name, o.total, DATE(o.order_date) AS dia, o.source
        FROM simora_v2.fact_orders o
        JOIN simora_v2.dim_customers c ON c.id = o.customer_id
        WHERE (o.customer_id, o.total, DATE(o.order_date)) IN (
            SELECT customer_id, total, DATE(order_date)
            FROM simora_v2.fact_orders
            WHERE customer_id IS NOT NULL AND total > 0
            GROUP BY customer_id, total, DATE(order_date)
            HAVING COUNT(*) > 1
        )
        ORDER BY dia DESC, o.total DESC
        LIMIT 20
    """)
    return Anomaly(
        check_id="A03", category="Integridad", severity="WARNING",
        title="Posibles pedidos duplicados (mismo cliente, monto y día)",
        detail=f"{n} combinaciones cliente+monto+día con más de 1 pedido. Revisar si son ventas legítimas múltiples o duplicados de importación.",
        count=n, rows=rows,
    )

def check_guias_sin_match_courier(conn) -> Anomaly | None:
    r = q1(conn, """
        SELECT COUNT(*) AS n,
               array_agg(fg.guide_number ORDER BY fg.ship_date DESC NULLS LAST) AS guides
        FROM simora_v2.fact_guides fg
        WHERE fg.guide_number LIKE 'MAG%'
          AND NOT EXISTS (
              SELECT 1 FROM simora_v2.fact_courier_reports cr
              WHERE cr.guide_number = fg.guide_number
          )
    """)
    n = int(r.get("n") or 0)
    if n == 0:
        return None
    return Anomaly(
        check_id="B01", category="Reconciliacion", severity="WARNING",
        title="Guias MAG en sistema sin reporte Domiflash",
        detail=f"{n} guias registradas internamente sin ningun reporte del courier. Pueden ser envios por otro operador o archivos XLSX faltantes.",
        count=n, rows=(r.get("guides") or [])[:10],
    )

def check_guias_courier_sin_sistema(conn) -> Anomaly | None:
    r = q1(conn, """
        SELECT COUNT(*) AS n
        FROM simora_v2.fact_courier_reports cr
        WHERE cr.guide_number LIKE 'MAG%'
          AND NOT EXISTS (
              SELECT 1 FROM simora_v2.fact_guides fg
              WHERE fg.guide_number = cr.guide_number
          )
    """)
    n = int(r.get("n") or 0)
    if n == 0:
        return None
    rows = q(conn, """
        SELECT cr.guide_number, cr.report_date, cr.destination, cr.status,
               cr.declared_value, cr.customer_name
        FROM simora_v2.fact_courier_reports cr
        WHERE cr.guide_number LIKE 'MAG%'
          AND NOT EXISTS (
              SELECT 1 FROM simora_v2.fact_guides fg
              WHERE fg.guide_number = cr.guide_number
          )
        ORDER BY cr.report_date DESC
        LIMIT 15
    """)
    return Anomaly(
        check_id="B02", category="Reconciliacion", severity="WARNING",
        title="Guias MAG en Domiflash sin registro interno",
        detail=f"{n} guias reportadas por Domiflash que no existen en el sistema. Pueden ser envios no capturados o errores de digitacion.",
        count=n, rows=rows,
    )

def check_devoluciones_sin_capturar(conn) -> Anomaly | None:
    r = q1(conn, """
        SELECT COUNT(*) AS n,
               ROUND(SUM(declared_value),0) AS valor_total
        FROM simora_v2.fact_courier_reports
        WHERE (status ILIKE '%devolu%' OR status ILIKE '%devuelto%' OR status ILIKE '%retorn%')
          AND guide_number LIKE 'MAG%'
    """)
    n = int(r.get("n") or 0)
    if n == 0:
        return None
    rows = q(conn, """
        SELECT status, COUNT(*) AS count,
               ROUND(SUM(declared_value),0) AS valor_cop
        FROM simora_v2.fact_courier_reports
        WHERE (status ILIKE '%devolu%' OR status ILIKE '%devuelto%' OR status ILIKE '%retorn%')
          AND guide_number LIKE 'MAG%'
        GROUP BY status ORDER BY count DESC
    """)
    return Anomaly(
        check_id="B03", category="Reconciliacion", severity="CRITICAL",
        title="Devoluciones en courier no cruzadas con el sistema",
        detail=f"{n} envios marcados como DEVOLUCION en Domiflash. Valor declarado total: ${int(r.get('valor_total') or 0):,} COP. Verificar si el sistema los tiene como devueltos y si el cobro fue revertido.",
        count=n, amount_cop=float(r.get("valor_total") or 0), rows=rows,
    )

def check_costo_flete_discrepancia(conn) -> Anomaly | None:
    r = q1(conn, """
        SELECT
            COUNT(*) AS n_comparadas,
            ROUND(SUM(cr.shipping_cost - COALESCE(fg.shipping_cost, 0)),0) AS diferencia_total,
            ROUND(AVG(cr.shipping_cost - COALESCE(fg.shipping_cost, 0)),0) AS diferencia_avg
        FROM simora_v2.fact_courier_reports cr
        JOIN simora_v2.fact_guides fg USING (guide_number)
        WHERE cr.guide_number LIKE 'MAG%'
          AND cr.shipping_cost IS NOT NULL
          AND fg.shipping_cost IS NOT NULL
          AND ABS(cr.shipping_cost - fg.shipping_cost) > 1000
    """)
    n = int(r.get("n_comparadas") or 0)
    diff = float(r.get("diferencia_total") or 0)
    if n == 0:
        return None
    severity: Severity = "CRITICAL" if abs(diff) > 5_000_000 else "WARNING"
    return Anomaly(
        check_id="C01", category="Financiero", severity=severity,
        title="Discrepancia costo flete sistema vs courier",
        detail=f"{n} guias con diferencia >$1,000 COP entre costo registrado en sistema y reportado por Domiflash. Diferencia total acumulada: ${int(diff):,} COP (courier cobra mas).",
        count=n, amount_cop=diff,
    )

def check_guias_sin_shipping_cost(conn) -> Anomaly | None:
    r = q1(conn, """
        SELECT COUNT(*) AS n_sin_costo, COUNT(*) FILTER (WHERE shipping_cost IS NOT NULL) AS n_con_costo
        FROM simora_v2.fact_guides
        WHERE guide_number LIKE 'MAG%'
    """)
    n_sin = int(r.get("n_sin_costo") or 0)
    n_con = int(r.get("n_con_costo") or 0)
    total = n_sin + n_con
    cobertura_pct = round(n_con / total * 100, 1) if total else 0
    if cobertura_pct > 80:
        return None
    return Anomaly(
        check_id="C02", category="Financiero", severity="WARNING",
        title="Baja cobertura de costo flete en guias del sistema",
        detail=f"Solo {n_con:,} de {total:,} guias ({cobertura_pct}%) tienen shipping_cost registrado. El {100-cobertura_pct}% restante ({n_sin:,} guias) no puede auditarse en costos.",
        count=n_sin,
    )

def check_outliers_revenue(conn) -> Anomaly | None:
    rows = q(conn, """
        SELECT source_id, tracking_code, total, order_date::date AS fecha,
               payment_type, source,
               ROUND((total - avg_t) / stddev_t, 1) AS z_score
        FROM simora_v2.fact_orders,
             (SELECT AVG(total) AS avg_t, STDDEV(total) AS stddev_t FROM simora_v2.fact_orders WHERE total > 0) stats
        WHERE total > avg_t + 3 * stddev_t
        ORDER BY total DESC
        LIMIT 20
    """)
    if not rows:
        return None
    return Anomaly(
        check_id="C03", category="Financiero", severity="WARNING",
        title="Pedidos con revenue atipicamente alto (> 3 sigma)",
        detail=f"{len(rows)} pedido(s) con total mas de 3 desviaciones estandar sobre la media. Pueden ser ventas al por mayor legítimas o errores de carga.",
        count=len(rows), rows=rows,
    )

def check_seller_duplicado(conn) -> Anomaly | None:
    rows = q(conn, """
        SELECT
            LOWER(REGEXP_REPLACE(full_name, '[^a-zA-ZáéíóúÁÉÍÓÚüÜñÑ ]', '', 'g')) AS nombre_normalizado,
            array_agg(DISTINCT full_name) AS variantes,
            array_agg(DISTINCT source) AS sources,
            COUNT(DISTINCT id) AS registros
        FROM simora_v2.dim_sellers
        GROUP BY nombre_normalizado
        HAVING COUNT(DISTINCT id) > 1
    """)
    if not rows:
        return None
    return Anomaly(
        check_id="D01", category="Sellers", severity="WARNING",
        title="Sellers duplicados entre fuentes (mismo nombre, distinta variante)",
        detail=f"{len(rows)} seller(s) aparecen con variaciones de nombre en legacy_mongo y novalogic. El revenue puede estar fragmentado entre registros.",
        count=len(rows), rows=rows,
    )

def check_seller_concentracion(conn) -> Anomaly | None:
    rows = q(conn, """
        SELECT s.full_name, s.source,
               COUNT(o.id) AS orders,
               ROUND(SUM(o.total),0) AS revenue,
               ROUND(SUM(o.total) * 100.0 / SUM(SUM(o.total)) OVER (), 1) AS pct_revenue
        FROM simora_v2.dim_sellers s
        JOIN simora_v2.fact_orders o ON o.seller_id = s.id
        GROUP BY s.id, s.full_name, s.source
        ORDER BY revenue DESC
    """)
    if not rows:
        return None
    top = rows[0]
    top_pct = float(top.get("pct_revenue") or 0)
    severity: Severity = "CRITICAL" if top_pct > 60 else ("WARNING" if top_pct > 40 else "INFO")
    return Anomaly(
        check_id="D02", category="Sellers", severity=severity,
        title=f"Concentracion de revenue en un seller ({top_pct}%)",
        detail=f"'{top['full_name']}' concentra el {top_pct}% del revenue total con {int(top['orders']):,} pedidos y ${int(top['revenue']):,} COP. Riesgo de dependencia critica.",
        count=len(rows), amount_cop=float(top.get("revenue") or 0), rows=rows,
    )

def check_meses_sin_datos(conn) -> Anomaly | None:
    rows = q(conn, """
        WITH meses AS (
            SELECT TO_CHAR(generate_series(
                (SELECT MIN(DATE_TRUNC('month', order_date)) FROM simora_v2.fact_orders),
                (SELECT MAX(DATE_TRUNC('month', order_date)) FROM simora_v2.fact_orders),
                '1 month'
            ), 'YYYY-MM') AS month
        ),
        con_datos AS (
            SELECT TO_CHAR(order_date, 'YYYY-MM') AS month, COUNT(*) AS orders
            FROM simora_v2.fact_orders WHERE order_date IS NOT NULL
            GROUP BY month
        )
        SELECT m.month, COALESCE(c.orders, 0) AS orders
        FROM meses m LEFT JOIN con_datos c USING (month)
        WHERE COALESCE(c.orders, 0) < 50
        ORDER BY m.month
    """)
    if not rows:
        return None
    severity: Severity = "CRITICAL" if any(int(r.get("orders") or 0) == 0 for r in rows) else "WARNING"
    return Anomaly(
        check_id="E01", category="Cobertura", severity=severity,
        title="Meses con datos insuficientes o ausentes en fact_orders",
        detail=f"{len(rows)} mes(es) con menos de 50 pedidos. Pueden indicar gaps de importacion o periodos de baja actividad real.",
        count=len(rows), rows=rows,
    )

def check_courier_meses_faltantes(conn) -> Anomaly | None:
    rows = q(conn, """
        SELECT source_file, COUNT(*) AS filas
        FROM simora_v2.fact_courier_reports
        GROUP BY source_file
        HAVING COUNT(*) < 10
        ORDER BY source_file
    """)
    if not rows:
        return None
    return Anomaly(
        check_id="E02", category="Cobertura", severity="WARNING",
        title="Archivos courier con muy pocas filas (posible archivo corrupto o vacio)",
        detail=f"{len(rows)} archivo(s) XLSX con menos de 10 filas cargadas. Revisar si el archivo original tiene datos.",
        count=len(rows), rows=rows,
    )

def check_cobros_courier_vs_banking(conn) -> Anomaly | None:
    r_courier = q1(conn, """
        SELECT COUNT(*) AS envios, ROUND(SUM(cash_collected),0) AS total_cobrado
        FROM simora_v2.fact_courier_reports
        WHERE cash_collected > 0 AND guide_number LIKE 'MAG%'
    """)
    r_banking = q1(conn, """
        SELECT COUNT(*) AS txns, ROUND(SUM(amount),0) AS total_ingresos
        FROM simora_v2.fact_bank_transactions
        WHERE amount > 0
    """)
    cobrado = float(r_courier.get("total_cobrado") or 0)
    ingresos = float(r_banking.get("total_ingresos") or 0)
    n_cobros = int(r_courier.get("envios") or 0)
    if n_cobros == 0:
        return Anomaly(
            check_id="F01", category="Flujo de Caja", severity="CRITICAL",
            title="Sin cobros registrados en reporte courier",
            detail="El campo cash_collected del courier tiene 0 registros con valor > 0 en guias MAG. Los envios contraentrega no tienen el cobro registrado en Domiflash, imposibilitando conciliacion bancaria.",
            count=0, amount_cop=0.0,
        )
    return Anomaly(
        check_id="F01", category="Flujo de Caja", severity="INFO",
        title="Cobertura cobros courier vs extracto bancario",
        detail=f"Courier reporta {n_cobros} cobros por ${int(cobrado):,} COP. Extracto bancario tiene ${int(ingresos):,} COP en ingresos totales (Ene-Jul 2025). Cruce directo limitado por cobertura de datos bancarios.",
        count=n_cobros, amount_cop=cobrado,
    )

def check_payment_contraentrega_sin_cobro(conn) -> Anomaly | None:
    r = q1(conn, """
        SELECT COUNT(*) AS n, ROUND(SUM(total),0) AS revenue_total
        FROM simora_v2.fact_orders o
        WHERE o.payment_type ILIKE '%cobro%' OR o.payment_type ILIKE '%contraentrega%'
    """)
    n_contraentrega = int(r.get("n") or 0)
    if n_contraentrega == 0:
        return None
    r2 = q1(conn, """
        SELECT COUNT(*) AS n_con_pago
        FROM simora_v2.fact_orders
        WHERE (payment_type ILIKE '%cobro%' OR payment_type ILIKE '%contraentrega%')
          AND payment_status IN ('collected', 'settled', 'paid')
    """)
    n_con_pago = int(r2.get("n_con_pago") or 0)
    sin_confirmar = n_contraentrega - n_con_pago
    pct_sin = round(sin_confirmar / n_contraentrega * 100, 1) if n_contraentrega else 0
    severity: Severity = "CRITICAL" if pct_sin > 50 else "WARNING"
    return Anomaly(
        check_id="F02", category="Flujo de Caja", severity=severity,
        title="Pedidos contraentrega sin confirmacion de pago recibido",
        detail=f"{sin_confirmar:,} de {n_contraentrega:,} pedidos contraentrega ({pct_sin}%) no tienen payment_status confirmado. Revenue en riesgo: ${int(r.get('revenue_total') or 0):,} COP.",
        count=sin_confirmar, amount_cop=float(r.get("revenue_total") or 0),
    )

# ─── RUNNER ───────────────────────────────────────────────────────────────────

ALL_CHECKS = [
    check_orders_sin_total,
    check_orders_sin_guia,
    check_duplicados_mismo_dia,
    check_guias_sin_match_courier,
    check_guias_courier_sin_sistema,
    check_devoluciones_sin_capturar,
    check_costo_flete_discrepancia,
    check_guias_sin_shipping_cost,
    check_outliers_revenue,
    check_seller_duplicado,
    check_seller_concentracion,
    check_meses_sin_datos,
    check_courier_meses_faltantes,
    check_cobros_courier_vs_banking,
    check_payment_contraentrega_sin_cobro,
]

SEVERITY_ORDER = {"CRITICAL": 0, "WARNING": 1, "INFO": 2}


def run_all(conn, min_severity: Severity = "INFO") -> list[Anomaly]:
    results = []
    for check_fn in ALL_CHECKS:
        try:
            anomaly = check_fn(conn)
            if anomaly and SEVERITY_ORDER[anomaly.severity] <= SEVERITY_ORDER[min_severity]:
                results.append(anomaly)
        except Exception as e:
            results.append(Anomaly(
                check_id=check_fn.__name__, category="Error", severity="CRITICAL",
                title=f"ERROR ejecutando {check_fn.__name__}",
                detail=str(e), count=0,
            ))
    results.sort(key=lambda a: SEVERITY_ORDER[a.severity])
    return results


def print_report(anomalies: list[Anomaly]):
    ICONS = {"CRITICAL": "[CRITICAL]", "WARNING": "[WARNING] ", "INFO":     "[INFO]    "}
    total = len(anomalies)
    by_sev = {s: sum(1 for a in anomalies if a.severity == s) for s in ["CRITICAL", "WARNING", "INFO"]}

    print(f"\n{'='*65}")
    print(f"  AGENTE DE ANOMALIAS CONTABLES — simora_v2")
    print(f"  Ejecutado: {date.today().isoformat()}")
    print(f"{'='*65}")
    print(f"  Total: {total} anomalia(s) | CRITICAL: {by_sev['CRITICAL']} | WARNING: {by_sev['WARNING']} | INFO: {by_sev['INFO']}")
    print(f"{'='*65}\n")

    for a in anomalies:
        icon = ICONS[a.severity]
        print(f"{icon} [{a.check_id}] {a.title}")
        print(f"          Categoria: {a.category}")
        if a.count:
            print(f"          Afectados: {a.count:,}")
        if a.amount_cop:
            print(f"          Monto COP: ${a.amount_cop:,.0f}")
        print(f"          {a.detail}")
        if a.rows:
            print(f"          Muestra ({min(5, len(a.rows))} de {len(a.rows)}):")
            for row in a.rows[:5]:
                if isinstance(row, dict):
                    line = " | ".join(f"{k}: {v}" for k, v in list(row.items())[:4])
                else:
                    line = str(row)
                print(f"            - {line}")
        print()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--min-severity", choices=["CRITICAL", "WARNING", "INFO"], default="INFO")
    parser.add_argument("--format", choices=["table", "json"], default="table")
    args = parser.parse_args()

    conn = psycopg2.connect(DB_DSN)
    try:
        anomalies = run_all(conn, args.min_severity)
    finally:
        conn.close()

    if args.format == "json":
        print(json.dumps([asdict(a) for a in anomalies], indent=2, default=str))
    else:
        print_report(anomalies)
