"""
ML 02: Segmentación RFM de clientes
=====================================
Objetivo: clasificar clientes en segmentos accionables basados en
  R = Recencia     (días desde último pedido)
  F = Frecuencia   (número de pedidos)
  M = Monetario    (valor total COP)

Output:
  - Tabla simora_v2.dim_customer_rfm (score + segmento por cliente)
  - Reporte de distribución de segmentos

Segmentos:
  Champions         R5 F4-5 M4-5  — compran mucho, seguido, reciente
  Loyal             R3-5 F3-5     — fieles, pueden mejorar en monetario
  Potential Loyalist R3-4 F1-3   — recientes con potencial
  At Risk           R2-3 F2-5 M2-5 — compraron bien pero no vuelven
  Can't Lose        R1-2 F4-5     — importantes pero inactivos
  Lost              R1 F1         — no vuelven

Uso:
  python 02_rfm_segmentation.py
"""

import sys
import json
from pathlib import Path
from datetime import datetime, timezone

import numpy  as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


CREATE_RFM_TABLE = """
CREATE TABLE IF NOT EXISTS simora_v2.dim_customer_rfm (
    customer_id      UUID PRIMARY KEY,
    last_order_date  DATE,
    recency_days     INTEGER,
    frequency        INTEGER,
    monetary         NUMERIC(14,2),
    r_score          SMALLINT,
    f_score          SMALLINT,
    m_score          SMALLINT,
    rfm_score        SMALLINT,
    segment          VARCHAR(30),
    updated_at       TIMESTAMPTZ DEFAULT NOW()
)
"""


def assign_segment(row: pd.Series) -> str:
    r, f, m = row["r_score"], row["f_score"], row["m_score"]
    rfm = row["rfm_score"]
    if r >= 4 and f >= 4 and m >= 4:
        return "Champions"
    if r >= 3 and f >= 3:
        return "Loyal"
    if r >= 3 and f <= 2:
        return "Potential Loyalist"
    if r <= 2 and f >= 3 and m >= 3:
        return "At Risk"
    if r <= 2 and f >= 4:
        return "Can't Lose"
    if rfm <= 6:
        return "Lost"
    return "Others"


def run():
    conn = simora_db.get_conn()

    with conn.cursor() as cur:
        cur.execute(CREATE_RFM_TABLE)
    conn.commit()

    print("Calculando RFM desde fact_orders...")
    df = pd.read_sql("""
        SELECT
            customer_id::text AS customer_id,
            MAX(order_date)   AS last_order,
            COUNT(*)          AS frequency,
            SUM(total)        AS monetary
        FROM simora_v2.fact_orders
        WHERE total > 0 AND customer_id IS NOT NULL
        GROUP BY customer_id
        HAVING COUNT(*) >= 1
    """, conn)

    print(f"  Clientes con al menos 1 pedido: {len(df):,}")

    now = datetime.now(tz=timezone.utc)
    df["last_order"]   = pd.to_datetime(df["last_order"], utc=True)
    df["recency_days"] = (now - df["last_order"]).dt.days

    # ── Scoring basado en percentil rank (1-5) ────────────────────────────
    # Más robusto que qcut cuando hay muchos valores iguales (e.g. frequency=1)
    def rank_score(series, ascending=True) -> pd.Series:
        pct = series.rank(pct=True, ascending=ascending)
        return np.ceil(pct * 5).clip(1, 5).astype(int)

    # Recencia: días más bajos = más reciente = mejor
    df["r_score"] = rank_score(df["recency_days"], ascending=False)
    # Frecuencia: más pedidos = mejor
    df["f_score"] = rank_score(df["frequency"], ascending=True)
    # Monetario: mayor gasto = mejor
    df["m_score"] = rank_score(df["monetary"], ascending=True)

    df["rfm_score"] = df["r_score"] + df["f_score"] + df["m_score"]
    df["segment"]   = df.apply(assign_segment, axis=1)

    # ── Reporte ───────────────────────────────────────────────────────────────
    seg_summary = df.groupby("segment").agg(
        count=("customer_id", "count"),
        avg_recency=("recency_days", "mean"),
        avg_frequency=("frequency", "mean"),
        avg_monetary=("monetary", "mean"),
        total_revenue=("monetary", "sum"),
    ).round(0).sort_values("total_revenue", ascending=False)

    print("\nSegmentos RFM:")
    print(seg_summary.to_string())

    # ── Guardar en DB ─────────────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("TRUNCATE simora_v2.dim_customer_rfm")
        for _, row in df.iterrows():
            cur.execute("""
                INSERT INTO simora_v2.dim_customer_rfm
                  (customer_id, last_order_date, recency_days, frequency, monetary,
                   r_score, f_score, m_score, rfm_score, segment)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (customer_id) DO UPDATE SET
                  last_order_date = EXCLUDED.last_order_date,
                  recency_days    = EXCLUDED.recency_days,
                  frequency       = EXCLUDED.frequency,
                  monetary        = EXCLUDED.monetary,
                  r_score         = EXCLUDED.r_score,
                  f_score         = EXCLUDED.f_score,
                  m_score         = EXCLUDED.m_score,
                  rfm_score       = EXCLUDED.rfm_score,
                  segment         = EXCLUDED.segment,
                  updated_at      = NOW()
            """, [
                row["customer_id"],
                row["last_order"].date(),
                int(row["recency_days"]),
                int(row["frequency"]),
                float(row["monetary"]),
                int(row["r_score"]),
                int(row["f_score"]),
                int(row["m_score"]),
                int(row["rfm_score"]),
                row["segment"],
            ])

    conn.commit()
    conn.close()

    result = {
        "total_customers_analyzed": len(df),
        "segments": seg_summary.reset_index().to_dict(orient="records"),
    }
    print(f"\n{len(df):,} clientes segmentados y guardados en dim_customer_rfm")
    return result


if __name__ == "__main__":
    result = run()
    print("\n" + json.dumps(result, indent=2, default=str))
