"""
Fix 03: Normalización de ciudades en fact_courier_reports
==========================================================
Problema: misma ciudad con variantes de capitalización y tildes.
  Bogotá / BOGOTÁ / BOGOTA / bogota → Bogotá
  Soacha / SOACHA                   → Soacha
  Zipa   / ZIPA   / Zipaquirá       → Zipaquirá
  etc.

Estrategia: tabla de mapeo estático basada en las 46 variantes
encontradas en los datos. Más confiable que fuzzy-match para este
volumen pequeño de ciudades (todo Cundinamarca / Bogotá).

Salida: UPDATE en fact_courier_reports.destination
        INSERT en simora_v2.dim_cities (tabla de referencia)
        Registro en bitácora audit.log_entries

Uso:
  python 03_normalize_cities.py --dry-run
  python 03_normalize_cities.py
"""

import sys
import argparse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

# ── Mapeo canónico (raw → canonical, código DIVIPOLA) ─────────────────────────
# Formato: "variante_como_aparece_en_db": ("Nombre Canónico", "código_divipola")
CITY_MAP: dict[str, tuple[str, str]] = {
    # Bogotá
    "Bogotá":       ("Bogotá D.C.",   "11001"),
    "BOGOTÁ":       ("Bogotá D.C.",   "11001"),
    "BOGOTA":       ("Bogotá D.C.",   "11001"),
    "bogota":       ("Bogotá D.C.",   "11001"),
    "bogotá":       ("Bogotá D.C.",   "11001"),
    # Soacha
    "Soacha":       ("Soacha",        "25754"),
    "SOACHA":       ("Soacha",        "25754"),
    # Paraíso (localidad Bogotá - tratar como Bogotá)
    "Paraíso":      ("Bogotá D.C.",   "11001"),
    "PARAÍSO":      ("Bogotá D.C.",   "11001"),
    "Paraiso":      ("Bogotá D.C.",   "11001"),
    "PARAISO":      ("Bogotá D.C.",   "11001"),
    # Mosquera
    "Mosquera":     ("Mosquera",      "25473"),
    "MOSQUERA":     ("Mosquera",      "25473"),
    # Madrid
    "Madrid":       ("Madrid",        "25430"),
    "MADRID":       ("Madrid",        "25430"),
    # Zipaquirá
    "Zipa":         ("Zipaquirá",     "25899"),
    "ZIPA":         ("Zipaquirá",     "25899"),
    "Zipaquirá":    ("Zipaquirá",     "25899"),
    "Zipaquira":    ("Zipaquirá",     "25899"),
    "ZIPAQUIRA":    ("Zipaquirá",     "25899"),
    # Chía
    "Chía":         ("Chía",          "25175"),
    "CHÍA":         ("Chía",          "25175"),
    "Chia":         ("Chía",          "25175"),
    "CHIA":         ("Chía",          "25175"),
    # Facatativá
    "Faca":         ("Facatativá",    "25269"),
    "FACA":         ("Facatativá",    "25269"),
    "Facatativá":   ("Facatativá",    "25269"),
    "Facatativa":   ("Facatativá",    "25269"),
    # Funza
    "Funza":        ("Funza",         "25286"),
    "FUNZA":        ("Funza",         "25286"),
    # Cajicá
    "Cajicá":       ("Cajicá",        "25126"),
    "CAJICÁ":       ("Cajicá",        "25126"),
    "Cajica":       ("Cajicá",        "25126"),
    "CAJICA":       ("Cajicá",        "25126"),
    # Tocancipá
    "Tocancipá":    ("Tocancipá",     "25817"),
    "TOCANCIPA":    ("Tocancipá",     "25817"),
    "Tocancipa":    ("Tocancipá",     "25817"),
    # Sopó
    "Sopó":         ("Sopó",          "25769"),
    "SOPO":         ("Sopó",          "25769"),
    # Sibaté
    "Sibaté":       ("Sibaté",        "25740"),
    "SIBATE":       ("Sibaté",        "25740"),
    # Cota
    "Cota":         ("Cota",          "25214"),
    "COTA":         ("Cota",          "25214"),
    # Tabio
    "Tabio":        ("Tabio",         "25785"),
    # San Luis (vereda/localidad en Bogotá)
    "San Luis":     ("Bogotá D.C.",   "11001"),
    # La Calera
    "La Calera":    ("La Calera",     "25377"),
    # Porvenir Rio / El Porvenir (Bosa - Bogotá)
    "Porvenir Rio": ("Bogotá D.C.",   "11001"),
    "PORVENIR RIO": ("Bogotá D.C.",   "11001"),
}


def ensure_dim_cities(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS simora_v2.dim_cities (
                raw_name    VARCHAR(150) PRIMARY KEY,
                canonical   VARCHAR(150) NOT NULL,
                divipola    VARCHAR(10),
                created_at  TIMESTAMPTZ DEFAULT NOW()
            )
        """)
    conn.commit()


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_dim_cities(conn)

    # ── Conteo inicial ──────────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT destination, COUNT(*) AS n
            FROM simora_v2.fact_courier_reports
            WHERE destination IS NOT NULL
            GROUP BY destination
            ORDER BY n DESC
        """)
        before = {r[0]: r[1] for r in cur.fetchall()}

    total_rows  = sum(before.values())
    mapped_rows = sum(v for k, v in before.items() if k in CITY_MAP and CITY_MAP[k][0] != k)
    not_in_map  = {k: v for k, v in before.items() if k not in CITY_MAP}

    print(f"Ciudades distintas encontradas: {len(before)}")
    print(f"Filas totales con destination:  {total_rows:,}")
    print(f"Filas que serán normalizadas:   {mapped_rows:,}")
    print(f"Sin cambio (ya canónico):       {total_rows - mapped_rows:,}")

    if not_in_map:
        print(f"\n⚠  Ciudades NO en el mapeo ({len(not_in_map)}):")
        for c, n in sorted(not_in_map.items(), key=lambda x: -x[1]):
            print(f"   {c!r:30s} ({n} filas)")

    if dry_run:
        print("\n[DRY RUN] No se aplican cambios.")
        conn.close()
        return {"mapped_rows": mapped_rows, "distinct_cities": len(before), "unmapped": list(not_in_map)}

    # ── Poblar dim_cities ──────────────────────────────────────────────────
    with conn.cursor() as cur:
        for raw, (canonical, divipola) in CITY_MAP.items():
            cur.execute("""
                INSERT INTO simora_v2.dim_cities (raw_name, canonical, divipola)
                VALUES (%s, %s, %s)
                ON CONFLICT (raw_name) DO UPDATE
                  SET canonical = EXCLUDED.canonical,
                      divipola  = EXCLUDED.divipola
            """, [raw, canonical, divipola])

    # ── Agregar columna city_canonical si no existe ─────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.fact_courier_reports
            ADD COLUMN IF NOT EXISTS city_canonical VARCHAR(150)
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_sv2_courier_city_canon
            ON simora_v2.fact_courier_reports (city_canonical)
        """)

    # ── Aplicar normalización ──────────────────────────────────────────────
    updated = 0
    with conn.cursor() as cur:
        for raw, (canonical, _) in CITY_MAP.items():
            cur.execute("""
                UPDATE simora_v2.fact_courier_reports
                SET city_canonical = %s
                WHERE destination = %s
            """, [canonical, raw])
            updated += cur.rowcount

        # Ciudades no mapeadas: city_canonical = UPPER(TRIM(destination))
        cur.execute("""
            UPDATE simora_v2.fact_courier_reports
            SET city_canonical = UPPER(TRIM(destination))
            WHERE destination IS NOT NULL AND city_canonical IS NULL
        """)
        updated += cur.rowcount

    conn.commit()

    # ── Verificación post ──────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT city_canonical, COUNT(*) AS n
            FROM simora_v2.fact_courier_reports
            GROUP BY city_canonical
            ORDER BY n DESC LIMIT 10
        """)
        print("\nTop 10 ciudades canónicas:")
        for r in cur.fetchall():
            print(f"  {str(r[0]):25s} {int(r[1]):>6,}")

    conn.close()
    print(f"\nTotal filas actualizadas: {updated:,}")
    return {"mapped_rows": mapped_rows, "updated": updated, "distinct_cities": len(before)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    run(args.dry_run)
