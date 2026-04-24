"""
ML 01: Modelo de predicción de entrega
========================================
Objetivo: para las 10,373 guías sin match en courier, estimar la
probabilidad de que hayan sido entregadas.

Dataset de entrenamiento: 14,753 guías con match confirmado.
  Features: destination_city, declared_value, shipping_cost,
            month, day_of_week, payment_type, carrier, source
  Target:   1 = ENTREGADO, 0 = DEVOLUCIÓN/RETENIDO/REPROGRAMADO

Output:
  - Columna fact_guides.predicted_delivered (FLOAT, probabilidad 0-1)
  - Columna fact_guides.predicted_status    (VARCHAR)
  - Reporte de métricas del modelo
  - Registros en audit.log_entries

Uso:
  python 01_delivery_predictor.py --train-only    # solo entrena, no predice
  python 01_delivery_predictor.py                 # entrena y predice
"""

import sys
import json
import argparse
import warnings
from pathlib import Path

import numpy  as np
import pandas as pd
from sklearn.ensemble        import GradientBoostingClassifier
from sklearn.model_selection import cross_val_score, train_test_split
from sklearn.preprocessing   import LabelEncoder
from sklearn.metrics         import (
    classification_report, roc_auc_score, confusion_matrix
)

warnings.filterwarnings("ignore")

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

# ── Columnas a agregar en fact_guides ──────────────────────────────────────
ALTER_SQL = """
ALTER TABLE simora_v2.fact_guides
  ADD COLUMN IF NOT EXISTS predicted_delivered FLOAT,
  ADD COLUMN IF NOT EXISTS predicted_status    VARCHAR(30),
  ADD COLUMN IF NOT EXISTS model_version       VARCHAR(20)
"""


def load_training_data(conn) -> pd.DataFrame:
    """Carga guías con match courier confirmado (ventana fecha)."""
    return pd.read_sql("""
        SELECT
            fg.id                   AS guide_id,
            fg.guide_number,
            fg.source,
            fg.destination_city,
            COALESCE(fg.shipping_cost, 0)   AS shipping_cost,
            COALESCE(fg.declared_value, 0)  AS declared_value,
            EXTRACT(MONTH FROM fg.ship_date)::int   AS month,
            EXTRACT(DOW   FROM fg.ship_date)::int   AS dow,
            EXTRACT(YEAR  FROM fg.ship_date)::int   AS year,
            fo.payment_type,
            fg.carrier,
            CASE WHEN cr.status ILIKE '%%ENTREGADO%%' THEN 1 ELSE 0 END AS delivered
        FROM simora_v2.fact_guides fg
        JOIN simora_v2.fact_courier_reports cr USING (guide_number)
        JOIN simora_v2.fact_orders fo ON fo.id = fg.order_id
        WHERE fg.guide_number LIKE 'MAG%%'
          AND cr.guide_number !~ '-[0-9]+$'
          AND fg.ship_date IS NOT NULL
          AND cr.report_date BETWEEN fg.ship_date - INTERVAL '90 days'
                                 AND fg.ship_date + INTERVAL '180 days'
    """, conn)


def load_prediction_data(conn) -> pd.DataFrame:
    """Carga guías SIN match courier para predecir."""
    return pd.read_sql("""
        SELECT
            fg.id                   AS guide_id,
            fg.guide_number,
            fg.source,
            fg.destination_city,
            COALESCE(fg.shipping_cost, 0)   AS shipping_cost,
            COALESCE(fg.declared_value, 0)  AS declared_value,
            EXTRACT(MONTH FROM fg.ship_date)::int   AS month,
            EXTRACT(DOW   FROM fg.ship_date)::int   AS dow,
            EXTRACT(YEAR  FROM fg.ship_date)::int   AS year,
            fo.payment_type,
            fg.carrier
        FROM simora_v2.fact_guides fg
        JOIN simora_v2.fact_orders fo ON fo.id = fg.order_id
        WHERE fg.guide_number LIKE 'MAG%%'
          AND fg.ship_date IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM simora_v2.fact_courier_reports cr
              WHERE cr.guide_number = fg.guide_number
                AND cr.guide_number !~ '-[0-9]+$'
                AND cr.report_date BETWEEN fg.ship_date - INTERVAL '90 days'
                                       AND fg.ship_date + INTERVAL '180 days'
          )
    """, conn)


CAT_COLS = ["source", "destination_city", "payment_type", "carrier"]
NUM_COLS = ["shipping_cost", "declared_value", "month", "dow", "year"]
ENCODERS: dict[str, LabelEncoder] = {}


def encode(df: pd.DataFrame, fit: bool) -> pd.DataFrame:
    df = df.copy()
    for col in CAT_COLS:
        df[col] = df[col].fillna("__UNKNOWN__").astype(str)
        if fit:
            le = LabelEncoder()
            df[col] = le.fit_transform(df[col])
            ENCODERS[col] = le
        else:
            le = ENCODERS[col]
            known = set(le.classes_)
            df[col] = df[col].apply(lambda x: x if x in known else "__UNKNOWN__")
            if "__UNKNOWN__" not in known:
                le.classes_ = np.append(le.classes_, "__UNKNOWN__")
            df[col] = le.transform(df[col])
    for col in NUM_COLS:
        df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)
    return df


def run(train_only: bool):
    conn = simora_db.get_conn()

    # ── Alteración de tabla ──────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute(ALTER_SQL)
    conn.commit()

    # ── Datos de entrenamiento ───────────────────────────────────────────────
    print("Cargando datos de entrenamiento...")
    df_train = load_training_data(conn)
    print(f"  {len(df_train):,} guías con match courier")
    print(f"  Distribución: {df_train['delivered'].value_counts().to_dict()}")

    if len(df_train) < 100:
        print("⚠  Insuficientes datos para entrenar. Se requieren ≥100 guías con match.")
        conn.close()
        return

    # ── Preparar features ─────────────────────────────────────────────────────
    X = encode(df_train[CAT_COLS + NUM_COLS], fit=True)
    y = df_train["delivered"].values

    X_tr, X_te, y_tr, y_te = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

    # ── Entrenar ─────────────────────────────────────────────────────────────
    print("\nEntrenando GradientBoostingClassifier...")
    model = GradientBoostingClassifier(
        n_estimators=200,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        random_state=42,
    )
    model.fit(X_tr, y_tr)

    # ── Métricas ─────────────────────────────────────────────────────────────
    y_pred  = model.predict(X_te)
    y_proba = model.predict_proba(X_te)[:, 1]
    auc     = roc_auc_score(y_te, y_proba)
    cv_auc  = cross_val_score(model, X, y, cv=5, scoring="roc_auc").mean()

    print(f"\nAUC test:        {auc:.3f}")
    print(f"AUC cross-val:   {cv_auc:.3f}")
    print("\nClassification report:")
    print(classification_report(y_te, y_pred, target_names=["No Entregado", "Entregado"]))

    # Feature importance
    importances = sorted(
        zip(CAT_COLS + NUM_COLS, model.feature_importances_),
        key=lambda x: -x[1]
    )
    print("Feature importance:")
    for feat, imp in importances:
        print(f"  {feat:25s} {imp:.3f}")

    metrics = {
        "auc_test":         round(auc, 3),
        "auc_cv_5fold":     round(float(cv_auc), 3),
        "train_samples":    len(X_tr),
        "test_samples":     len(X_te),
        "delivered_rate":   round(float(y.mean()), 3),
        "feature_importance": {f: round(float(i), 3) for f, i in importances},
    }

    if train_only:
        print("\n[--train-only] No se aplican predicciones.")
        conn.close()
        return metrics

    # ── Predecir sobre guías sin match ────────────────────────────────────────
    print("\nCargando guías sin match...")
    df_pred = load_prediction_data(conn)
    print(f"  {len(df_pred):,} guías a predecir")

    if len(df_pred) == 0:
        print("No hay guías sin match para predecir.")
        conn.close()
        return metrics

    X_pred  = encode(df_pred[CAT_COLS + NUM_COLS], fit=False)
    proba   = model.predict_proba(X_pred)[:, 1]
    labels  = np.where(proba >= 0.5, "ENTREGADO_ESTIMADO", "DEVOLUCION_ESTIMADA")

    df_pred["predicted_delivered"] = proba
    df_pred["predicted_status"]    = labels

    print(f"  Estimados entregados: {(labels == 'ENTREGADO_ESTIMADO').sum():,} ({round((labels == 'ENTREGADO_ESTIMADO').mean()*100,1)}%)")
    print(f"  Estimados devueltos:  {(labels == 'DEVOLUCION_ESTIMADA').sum():,}")

    # ── Escribir predicciones en DB ───────────────────────────────────────────
    MODEL_VERSION = "gbm_v1"
    with conn.cursor() as cur:
        for _, row in df_pred.iterrows():
            cur.execute("""
                UPDATE simora_v2.fact_guides
                SET predicted_delivered = %s,
                    predicted_status    = %s,
                    model_version       = %s
                WHERE id = %s
            """, [
                round(float(row["predicted_delivered"]), 4),
                row["predicted_status"],
                MODEL_VERSION,
                row["guide_id"],
            ])

    conn.commit()
    conn.close()

    metrics["predicted_count"]     = len(df_pred)
    metrics["predicted_delivered"] = int((labels == "ENTREGADO_ESTIMADO").sum())
    metrics["predicted_returned"]  = int((labels == "DEVOLUCION_ESTIMADA").sum())
    metrics["model_version"]       = MODEL_VERSION

    print(f"\nPredicciones escritas en fact_guides.predicted_delivered")
    return metrics


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--train-only", action="store_true")
    args = parser.parse_args()
    result = run(args.train_only)
    if result:
        print("\n" + json.dumps(result, indent=2))
