"""
Fix 06: Clasificacion de pagos — modalidad y medio
====================================================
Objetivo: transformar el campo ambiguo payment_type en dos dimensiones
          limpias y fiables SIN perder ni modificar data original.

Estrategia (100% aditiva — nunca borra ni modifica columnas existentes):
  1. Crear dim_payment_modality  (tabla de referencia)
  2. Crear dim_payment_method    (tabla de referencia)
  3. Agregar columnas nuevas a fact_orders:
       - payment_modality   VARCHAR(20)  -- contraentrega | anticipado | hibrido | exento
       - payment_method     VARCHAR(30)  -- efectivo | transferencia | digital | addi | ...
       - carrier_inferred   VARCHAR(50)  -- carrier derivado de guias o tipo de pago
  4. Normalizar payment_type (typos) en columna separada payment_type_norm
  5. Backfill carrier_inferred desde fact_guides donde hay dato
  6. Aplicar reglas de clasificacion
  7. Registrar en bitacora audit.log_entries

Reglas de negocio:
  Modalidad CONTRAENTREGA:
    Contraentrega, Contrentrega (typo)       -> Domiflash / Servientrega (carrier variable)
    Pago en casa                             -> Interrapidisimo exclusivo
  Modalidad HIBRIDO (producto anticipado + flete COD):
    Al Cobro                                 -> Interrapidisimo exclusivo
  Modalidad ANTICIPADO:
    Anticipado, Contado                      -> pre-pagado generico
    Digital, digital                         -> plataforma digital
    Transferencia                            -> transferencia bancaria
    Addi, addi                               -> credito Addi
    Sistecredito, sistecredito               -> credito Sistecredito
    Tarjeta                                  -> tarjeta debito/credito
  Exento:
    Sin Cobro                                -> sin cobro

Uso:
  python 06_payment_classification.py --dry-run
  python 06_payment_classification.py
"""

import sys
import argparse
from pathlib import Path
from datetime import datetime, timezone

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


# ---------------------------------------------------------------------------
# Tablas de referencia
# ---------------------------------------------------------------------------
DIM_MODALITY_ROWS = [
    ("contraentrega", "Contraentrega",
     "El cliente paga al recibir el producto. El courier recauda."),
    ("anticipado",    "Anticipado",
     "El cliente paga antes del despacho. El dinero ya esta en poder de la empresa."),
    ("hibrido",       "Hibrido (Al Cobro)",
     "Producto pago anticipado, flete se cobra al momento de la entrega (Interrapidisimo)."),
    ("exento",        "Sin Cobro",
     "Pedido sin valor a recaudar."),
    ("desconocido",   "Desconocido",
     "No fue posible clasificar con los datos disponibles."),
]

DIM_METHOD_ROWS = [
    ("efectivo",      "Efectivo",        False,
     "Pago en billetes/monedas. Default en contraentrega via courier."),
    ("transferencia", "Transferencia",   True,
     "Transferencia bancaria anticipada."),
    ("digital",       "Digital",         True,
     "Plataforma digital (Nequi, Daviplata u otra). Incluye 'digital' y 'Digital'."),
    ("addi",          "Addi",            True,
     "Credito Addi. Pago anticipado via plataforma."),
    ("sistecredito",  "Sistecredito",    True,
     "Credito Sistecredito. Pago anticipado via plataforma."),
    ("tarjeta",       "Tarjeta",         True,
     "Tarjeta debito o credito. Pago anticipado."),
    ("pre_pagado",    "Pre-pagado",      True,
     "Pago anticipado sin medio especifico registrado (Anticipado / Contado)."),
    ("exento",        "Sin Cobro",       False,
     "Sin recaudo."),
    ("desconocido",   "Desconocido",     False,
     "Medio no identificado con los datos disponibles."),
]


# ---------------------------------------------------------------------------
# Mapa de clasificacion  payment_type_norm -> (modality, method)
# ---------------------------------------------------------------------------
PAYMENT_MAP: dict[str, tuple[str, str]] = {
    # Contraentrega Domiflash / Servientrega
    "contraentrega":  ("contraentrega", "efectivo"),
    # Interrapidisimo exclusivos
    "pago en casa":   ("contraentrega", "efectivo"),
    "al cobro":       ("hibrido",       "efectivo"),
    "contado":        ("anticipado",    "pre_pagado"),
    # Anticipado generico
    "anticipado":     ("anticipado",    "pre_pagado"),
    # Medios digitales anticipados
    "digital":        ("anticipado",    "digital"),
    "transferencia":  ("anticipado",    "transferencia"),
    "addi":           ("anticipado",    "addi"),
    "sistecredito":   ("anticipado",    "sistecredito"),
    "tarjeta":        ("anticipado",    "tarjeta"),
    # Sin cobro
    "sin cobro":      ("exento",        "exento"),
}

# Normalizacion de typos y variantes de case -> clave del mapa
NORMALIZE_MAP: dict[str, str] = {
    "contraentrega":  "contraentrega",
    "contrentrega":   "contraentrega",   # typo
    "pago en casa":   "pago en casa",
    "al cobro":       "al cobro",
    "contado":        "contado",
    "anticipado":     "anticipado",
    "digital":        "digital",
    "transferencia":  "transferencia",
    "addi":           "addi",
    "sistecredito":   "sistecredito",
    "tarjeta":        "tarjeta",
    "sin cobro":      "sin cobro",
}

# Carrier inferido por payment_type (solo los exclusivos de Interrapidisimo)
CARRIER_BY_PAYMENT: dict[str, str] = {
    "pago en casa": "Interrapidisimo",
    "al cobro":     "Interrapidisimo",
    "contado":      "Interrapidisimo",
}


# ---------------------------------------------------------------------------
# DDL helpers
# ---------------------------------------------------------------------------
def ensure_dim_tables(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS simora_v2.dim_payment_modality (
                code        VARCHAR(20)  PRIMARY KEY,
                name        VARCHAR(50)  NOT NULL,
                description TEXT,
                created_at  TIMESTAMPTZ  DEFAULT NOW()
            )
        """)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS simora_v2.dim_payment_method (
                code           VARCHAR(30)  PRIMARY KEY,
                name           VARCHAR(50)  NOT NULL,
                is_electronic  BOOLEAN      NOT NULL DEFAULT FALSE,
                description    TEXT,
                created_at     TIMESTAMPTZ  DEFAULT NOW()
            )
        """)
        # Poblar dim_payment_modality
        for code, name, desc in DIM_MODALITY_ROWS:
            cur.execute("""
                INSERT INTO simora_v2.dim_payment_modality (code, name, description)
                VALUES (%s, %s, %s)
                ON CONFLICT (code) DO UPDATE
                  SET name = EXCLUDED.name, description = EXCLUDED.description
            """, [code, name, desc])

        # Poblar dim_payment_method
        for code, name, is_elec, desc in DIM_METHOD_ROWS:
            cur.execute("""
                INSERT INTO simora_v2.dim_payment_method
                  (code, name, is_electronic, description)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (code) DO UPDATE
                  SET name          = EXCLUDED.name,
                      is_electronic = EXCLUDED.is_electronic,
                      description   = EXCLUDED.description
            """, [code, name, is_elec, desc])

    conn.commit()
    print("Tablas dim_payment_modality y dim_payment_method listas.")


def ensure_fact_orders_columns(conn):
    """Agrega columnas nuevas a fact_orders. Nunca modifica las existentes."""
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.fact_orders
              ADD COLUMN IF NOT EXISTS payment_type_norm  VARCHAR(30),
              ADD COLUMN IF NOT EXISTS payment_modality   VARCHAR(20)
                  REFERENCES simora_v2.dim_payment_modality(code),
              ADD COLUMN IF NOT EXISTS payment_method     VARCHAR(30)
                  REFERENCES simora_v2.dim_payment_method(code),
              ADD COLUMN IF NOT EXISTS carrier_inferred   VARCHAR(50)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_fo_payment_modality
            ON simora_v2.fact_orders (payment_modality)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_fo_payment_method
            ON simora_v2.fact_orders (payment_method)
        """)
    conn.commit()
    print("Columnas nuevas en fact_orders listas.")


# ---------------------------------------------------------------------------
# Logica principal
# ---------------------------------------------------------------------------
def run(dry_run: bool):
    conn = simora_db.get_conn()

    ensure_dim_tables(conn)
    ensure_fact_orders_columns(conn)

    # ── 1. Leer todos los pedidos con su payment_type actual ─────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, payment_type, carrier_inferred
            FROM simora_v2.fact_orders
        """)
        orders = cur.fetchall()

    print(f"Pedidos a clasificar: {len(orders):,}")

    # ── 2. Backfill carrier_inferred desde fact_guides ───────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT DISTINCT fo.id, fg.carrier
            FROM simora_v2.fact_orders fo
            JOIN simora_v2.fact_guides fg ON fg.order_id = fo.id
            WHERE fg.carrier IS NOT NULL
        """)
        carrier_from_guides = {str(row[0]): row[1] for row in cur.fetchall()}

    print(f"Carriers recuperados desde fact_guides: {len(carrier_from_guides):,}")

    # ── 3. Clasificar cada pedido ─────────────────────────────────────────────
    classified   = []
    unclassified = []

    for order_id, payment_type, carrier_existing in orders:
        raw_pt   = (payment_type or "").strip()
        norm_key = NORMALIZE_MAP.get(raw_pt.lower())
        pt_norm  = norm_key if norm_key else raw_pt.lower() if raw_pt else None

        modality, method = PAYMENT_MAP.get(norm_key, ("desconocido", "desconocido")) \
            if norm_key else ("desconocido", "desconocido")

        # Carrier: primero desde guias, luego inferido por tipo de pago,
        # finalmente conservar el existente si ya tenia valor
        carrier = (
            carrier_from_guides.get(str(order_id))
            or CARRIER_BY_PAYMENT.get(norm_key)
            or carrier_existing
        )

        classified.append({
            "id":               order_id,
            "payment_type_norm": pt_norm,
            "payment_modality":  modality,
            "payment_method":    method,
            "carrier_inferred":  carrier,
        })

        if modality == "desconocido":
            unclassified.append((order_id, raw_pt))

    # ── Reporte de clasificacion ──────────────────────────────────────────────
    from collections import Counter
    mod_counts    = Counter(r["payment_modality"]   for r in classified)
    method_counts = Counter(r["payment_method"]     for r in classified)
    carrier_counts = Counter(r["carrier_inferred"] or "sin_carrier" for r in classified)

    print("\nModalidad de pago:")
    for k, v in mod_counts.most_common():
        print(f"  {k:20s} {v:>6,}  ({round(v/len(classified)*100,1)}%)")

    print("\nMedio de pago:")
    for k, v in method_counts.most_common():
        print(f"  {k:20s} {v:>6,}  ({round(v/len(classified)*100,1)}%)")

    print("\nCarrier inferido:")
    for k, v in carrier_counts.most_common():
        print(f"  {k:20s} {v:>6,}  ({round(v/len(classified)*100,1)}%)")

    if unclassified:
        print(f"\nNo clasificados: {len(unclassified)} (payment_type desconocido)")
        for oid, pt in unclassified[:10]:
            print(f"  id={oid}  payment_type={pt!r}")

    if dry_run:
        print("\n[DRY RUN] No se aplican cambios.")
        conn.close()
        return {
            "total": len(classified),
            "modality": dict(mod_counts),
            "method":   dict(method_counts),
            "unclassified": len(unclassified),
        }

    # ── 4. Aplicar en bloques de 500 (evitar timeouts) ───────────────────────
    BATCH = 500
    total_updated = 0

    with conn.cursor() as cur:
        batch = []
        for i, r in enumerate(classified):
            batch.append(r)
            if len(batch) == BATCH or i == len(classified) - 1:
                for rec in batch:
                    cur.execute("""
                        UPDATE simora_v2.fact_orders
                        SET payment_type_norm = %s,
                            payment_modality  = %s,
                            payment_method    = %s,
                            carrier_inferred  = %s
                        WHERE id = %s
                    """, [
                        rec["payment_type_norm"],
                        rec["payment_modality"],
                        rec["payment_method"],
                        rec["carrier_inferred"],
                        rec["id"],
                    ])
                total_updated += len(batch)
                batch = []

    conn.commit()
    print(f"\nfact_orders actualizados: {total_updated:,}")

    # ── 5. Verificacion post ─────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT payment_modality, payment_method, COUNT(*) as n
            FROM simora_v2.fact_orders
            GROUP BY payment_modality, payment_method
            ORDER BY n DESC
        """)
        print("\nVerificacion final (modalidad x medio):")
        for row in cur.fetchall():
            print(f"  {str(row[0]):20s} / {str(row[1]):15s}  {int(row[2]):>6,}")

        cur.execute("""
            SELECT COUNT(*) FROM simora_v2.fact_orders
            WHERE payment_modality IS NULL OR payment_method IS NULL
        """)
        nulls = cur.fetchone()[0]
        print(f"\nRegistros sin clasificar: {nulls}")

    # ── 6. Registrar en bitacora ─────────────────────────────────────────────
    try:
        audit_conn = simora_db.get_conn()
        with audit_conn.cursor() as cur:
            cur.execute("""
                INSERT INTO audit.log_entries
                  (slug, category, severity, title, body, tags,
                   source, affected_count, status)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (slug) DO UPDATE
                  SET body         = EXCLUDED.body,
                      affected_count = EXCLUDED.affected_count,
                      updated_at   = NOW()
            """, [
                "fix-06-payment-classification",
                "data_quality",
                "info",
                "Fix 06: Clasificacion de modalidad y medio de pago",
                (
                    f"Se agregaron columnas payment_type_norm, payment_modality, payment_method "
                    f"y carrier_inferred a fact_orders ({total_updated:,} registros). "
                    f"Tablas de referencia creadas: dim_payment_modality, dim_payment_method. "
                    f"Distribucion modalidad: {dict(mod_counts)}. "
                    f"Distribucion medio: {dict(method_counts)}. "
                    f"Registros sin clasificar: {nulls}. "
                    f"Carrier inferido desde fact_guides: {len(carrier_from_guides):,} ordenes. "
                    f"Carrier inferido por tipo de pago (Interrapidisimo): Al Cobro={mod_counts.get('hibrido',0)}, "
                    f"Pago en casa+Contado incluidos en contraentrega/anticipado. "
                    f"NOTA: carrier_inferred es NULL en {carrier_counts.get('sin_carrier',0):,} ordenes "
                    f"porque fact_guides.carrier no esta poblado para el periodo legacy."
                ),
                ["fix", "payment", "classification", "fact_orders"],
                "06_payment_classification.py",
                total_updated,
                "resolved",
            ])
        audit_conn.commit()
        audit_conn.close()
        print("\nBitacora actualizada.")
    except Exception as e:
        print(f"\n[!] No se pudo registrar en bitacora: {e}")

    conn.close()
    return {
        "total_updated":  total_updated,
        "modality":       dict(mod_counts),
        "method":         dict(method_counts),
        "carrier_filled": len(carrier_from_guides),
        "unclassified":   nulls,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    import json
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
