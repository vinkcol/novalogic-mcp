"""
Fix 10: Resolución de carrier por ciudad + modalidad de pago
=============================================================
Objetivo: poblar carrier_resolved y carrier_confidence en fact_orders
          usando dos señales combinadas:
            1. Ciudad → zona Domiflash (dim_cities cubre exactamente
               Bogotá DC + Cundinamarca local = cobertura Domiflash)
            2. Modalidad de pago → Interrapidísimo (al cobro / pago en casa)
               vs Servientrega (nacional estándar)

Árbol de decisión:
  IF city ∈ domiflash_cities            → Domiflash        confidence=high
  ELIF payment IN ('al cobro',
                   'pago en casa')       → Interrapidísimo  confidence=high
  ELIF modality IN ('contraentrega',
                    'hibrido')           → Servientrega     confidence=medium
  ELIF modality = 'anticipado'          → Servientrega     confidence=low
  ELSE                                   → NULL

Pase 2 — órdenes sin ciudad (source=novalogic):
  Intentar obtener ciudad desde fact_dispatch_log (via source_id=mongo_id
  o guide_number) y re-aplicar el mismo árbol.

Nota: MAG en guide_number es prefijo de la marca (Magibell/Magistral),
      no identifica courier. Carrier se infiere SOLO por ciudad + pago.

Uso:
  python 10_resolve_carrier.py --dry-run
  python 10_resolve_carrier.py
"""

import sys
import json
import argparse
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def normalize(s: str) -> str:
    """Minúsculas + sin tildes + strip."""
    if not s:
        return ""
    s = str(s).lower().strip()
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")


def ensure_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.fact_orders
              ADD COLUMN IF NOT EXISTS carrier_resolved   VARCHAR(50),
              ADD COLUMN IF NOT EXISTS carrier_confidence VARCHAR(10)
        """)
    conn.commit()


def build_domiflash_city_set(conn) -> set:
    """
    Retorna un set de versiones normalizadas de todos los raw_name en dim_cities.
    dim_cities contiene exactamente las ciudades de la Zona Local Domiflash
    (Bogotá DC + 13 municipios de Cundinamarca).
    """
    with conn.cursor() as cur:
        cur.execute("SELECT raw_name FROM simora_v2.dim_cities")
        rows = cur.fetchall()
    return {normalize(r[0]) for r in rows}


def resolve_carrier(city: str, payment_type_norm: str, payment_modality: str,
                    domiflash_set: set) -> tuple[str, str]:
    """Retorna (carrier_resolved, carrier_confidence) o (None, None)."""
    city_norm = normalize(city) if city else ""

    if city_norm and city_norm in domiflash_set:
        return ("Domiflash", "high")

    ptn = (payment_type_norm or "").strip().lower()
    mod = (payment_modality or "").strip().lower()

    if ptn in ("al cobro", "pago en casa"):
        return ("Interrapidisimo", "high")

    if mod in ("contraentrega", "hibrido"):
        return ("Servientrega", "medium")

    if mod == "anticipado":
        return ("Servientrega", "low")

    return (None, None)


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_columns(conn)

    domiflash_set = build_domiflash_city_set(conn)
    print(f"Ciudades Domiflash cargadas: {len(domiflash_set)}")

    # ── 1. Cargar fact_orders ─────────────────────────────────────────────────
    print("\nCargando fact_orders...")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, city, payment_type_norm, payment_modality,
                   source_id, guide_number
            FROM simora_v2.fact_orders
        """)
        orders = cur.fetchall()
    print(f"  {len(orders):,} pedidos cargados")

    # ── 2. Pase 1: resolver con city propia ──────────────────────────────────
    print("\nPase 1: resolución por ciudad propia...")
    resolved   = []   # (id, carrier, confidence)
    need_city  = []   # (id, source_id, guide_number, payment_type_norm, payment_modality)

    for oid, city, ptn, mod, src_id, guide in orders:
        carrier, conf = resolve_carrier(city, ptn, mod, domiflash_set)
        if carrier:
            resolved.append((str(oid), carrier, conf))
        elif not city or city.strip() == "":
            need_city.append((str(oid), src_id, guide, ptn, mod))
        else:
            # Tiene ciudad pero no matchea → no inferible con señales actuales
            resolved.append((str(oid), None, None))

    print(f"  Resueltos en pase 1 : {len(resolved):,}")
    print(f"  Sin ciudad (pase 2) : {len(need_city):,}")

    # ── 3. Pase 2: obtener ciudad desde fact_dispatch_log ────────────────────
    if need_city:
        print("\nPase 2: buscando ciudad en fact_dispatch_log...")

        # Mapa source_id → city (ruta A)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT fo.source_id, dl.city
                FROM simora_v2.fact_orders fo
                JOIN simora_v2.fact_dispatch_log dl
                  ON dl.mongo_id = fo.source_id
                WHERE fo.city IS NULL OR fo.city = ''
                  AND dl.city IS NOT NULL AND dl.city != ''
            """)
            city_by_source = {r[0]: r[1] for r in cur.fetchall()}

        # Mapa guide_number → city (ruta B)
        with conn.cursor() as cur:
            cur.execute("""
                SELECT fo.guide_number, dl.city
                FROM simora_v2.fact_orders fo
                JOIN simora_v2.fact_dispatch_log dl
                  ON dl.guide_number = fo.guide_number
                WHERE (fo.city IS NULL OR fo.city = '')
                  AND fo.guide_number IS NOT NULL
                  AND dl.city IS NOT NULL AND dl.city != ''
                GROUP BY fo.guide_number, dl.city
            """)
            city_by_guide = {r[0]: r[1] for r in cur.fetchall()}

        resolved_p2 = 0
        for oid, src_id, guide, ptn, mod in need_city:
            city = city_by_source.get(src_id) or city_by_guide.get(guide)
            carrier, conf = resolve_carrier(city, ptn, mod, domiflash_set)
            if carrier and city:
                # Downgrade confidence un nivel (la ciudad viene de dispatch_log)
                conf = "medium" if conf == "high" else "low"
            resolved.append((oid, carrier, conf))
            if carrier:
                resolved_p2 += 1

        print(f"  Resueltos en pase 2 : {resolved_p2:,}")

    # ── 4. Estadísticas antes de escribir ────────────────────────────────────
    from collections import Counter
    counter = Counter(
        (c or "NULL", cf or "NULL")
        for _, c, cf in resolved
    )

    print("\n=== DISTRIBUCIÓN ESPERADA ===")
    for (carrier, conf), n in sorted(counter.items(), key=lambda x: -x[1]):
        print(f"  {carrier:20s}  conf={conf:6s}  {n:>6,}")

    total_resolved = sum(1 for _, c, _ in resolved if c)
    total_null     = sum(1 for _, c, _ in resolved if not c)
    print(f"\n  Resueltos : {total_resolved:,} / {len(resolved):,} ({round(total_resolved/len(resolved)*100,1)}%)")
    print(f"  Sin inferir: {total_null:,}")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        conn.close()
        return {
            "dry_run": True,
            "distribution": {f"{c}:{cf}": n for (c, cf), n in counter.items()},
            "resolved": total_resolved,
            "unresolved": total_null,
        }

    # ── 5. Actualizar fact_orders ─────────────────────────────────────────────
    print("\nActualizando carrier_resolved / carrier_confidence...")
    BATCH = 500
    updated = 0
    with conn.cursor() as cur:
        for i in range(0, len(resolved), BATCH):
            batch = resolved[i:i + BATCH]
            for oid, carrier, conf in batch:
                cur.execute("""
                    UPDATE simora_v2.fact_orders
                    SET carrier_resolved   = %s,
                        carrier_confidence = %s
                    WHERE id = %s
                      AND (carrier_resolved IS DISTINCT FROM %s
                           OR carrier_confidence IS DISTINCT FROM %s)
                """, [carrier, conf, oid, carrier, conf])
                updated += cur.rowcount
    conn.commit()
    print(f"  Filas actualizadas: {updated:,}")

    # ── 6. Estado final ───────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT carrier_resolved, carrier_confidence,
                   COUNT(*) AS n,
                   COUNT(*) FILTER (WHERE delivery_status = 'delivered') AS delivered,
                   ROUND(AVG(total)::numeric, 0) AS avg_total
            FROM simora_v2.fact_orders
            GROUP BY carrier_resolved, carrier_confidence
            ORDER BY n DESC
        """)
        print(f"  {'carrier':22s} {'conf':8s} {'total':>7s}  {'deliv':>6s}  {'avg_total':>10s}")
        for row in cur.fetchall():
            carrier = str(row[0]) if row[0] else "NULL"
            conf    = str(row[1]) if row[1] else "-"
            print(f"  {carrier:22s} {conf:8s} {int(row[2]):>7,}  {int(row[3]):>6,}  {int(row[4] or 0):>10,}")

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
                "medium",
                "Fix 10: carrier_resolved inferido por ciudad + modalidad de pago",
                (
                    f"carrier_resolved poblado en {total_resolved:,} pedidos. "
                    f"Logica: ciudad en zona Domiflash (Bogota+Sabana) -> Domiflash/high; "
                    f"payment_type_norm in (al cobro, pago en casa) -> Interrapidisimo/high; "
                    f"nacional contraentrega -> Servientrega/medium; "
                    f"anticipado nacional -> Servientrega/low. "
                    f"Pase 2 uso fact_dispatch_log.city para {len(need_city):,} pedidos sin ciudad. "
                    f"Sin inferir: {total_null:,}. "
                    f"Nota: MAG en guide_number es prefijo de marca (Magibell/Magistral), no courier."
                ),
                ["fix", "carrier", "logistics", "domiflash", "servientrega", "interrapidisimo"],
                "10_resolve_carrier.py",
                total_resolved,
                "resolved",
            ])
        conn.commit()
        print("\nBitacora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitacora: {e}")

    conn.close()
    return {
        "resolved": total_resolved,
        "unresolved": total_null,
        "distribution": {f"{c}:{cf}": n for (c, cf), n in counter.items()},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
