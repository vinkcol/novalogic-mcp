"""
Fix 05: Deduplicación de dim_customers
=======================================
Problema: 21,731 registros con solo 18,202 nombres únicos → 16.2% duplicación.
Solo 1,563 emails únicos de 21,731 clientes (muchos sin email).

Estrategia (sin ML pesado, solo SQL + rapidfuzz):
  1. Bloques de deduplicación:
     a) Email exacto (mismo email → mismo cliente)
     b) Teléfono exacto + ciudad
     c) Nombre normalizado + ciudad (Jaro-Winkler ≥ 0.92)
  2. Para cada cluster: mantener el registro más completo como canónico.
  3. Crear tabla simora_v2.customer_merge_map (from_id → to_id) para
     redirigir FKs sin borrar datos históricos.
  4. Actualizar fact_orders.customer_id con el ID canónico.

NO borra registros — preserva trazabilidad.

Uso:
  python 05_dedup_customers.py --dry-run       # solo análisis
  python 05_dedup_customers.py --min-score 92  # umbral Jaro-Winkler (0-100)
  python 05_dedup_customers.py                 # aplica con score ≥ 92
"""

import sys
import re
import unicodedata
import argparse
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

try:
    from rapidfuzz.distance import JaroWinkler
    HAVE_RAPIDFUZZ = True
except ImportError:
    HAVE_RAPIDFUZZ = False
    print("⚠  rapidfuzz no disponible — solo se aplicará dedup por email/teléfono exacto")


def normalize_name(name: str) -> str:
    """Normaliza para comparación: minúsculas, sin tildes, sin dobles espacios."""
    if not name:
        return ""
    n = unicodedata.normalize("NFD", name)
    n = "".join(c for c in n if unicodedata.category(c) != "Mn")
    n = re.sub(r"[^a-z0-9 ]", "", n.lower())
    return re.sub(r"\s+", " ", n).strip()


def normalize_phone(p: str) -> str:
    if not p:
        return ""
    return re.sub(r"\D", "", p)[-10:]  # últimos 10 dígitos


def ensure_merge_table(conn):
    with conn.cursor() as cur:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS simora_v2.customer_merge_map (
                from_id    UUID NOT NULL,
                to_id      UUID NOT NULL,
                method     VARCHAR(30),
                score      NUMERIC(5,2),
                created_at TIMESTAMPTZ DEFAULT NOW(),
                PRIMARY KEY (from_id)
            )
        """)
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_merge_map_to
            ON simora_v2.customer_merge_map (to_id)
        """)
    conn.commit()


def run(dry_run: bool, min_score: int = 92):
    conn = simora_db.get_conn()
    ensure_merge_table(conn)

    # ── Cargar todos los clientes ────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, full_name, email, phone, city, document_number
            FROM simora_v2.dim_customers
            ORDER BY imported_at ASC  -- más antiguos primero → serán canónicos
        """)
        rows = cur.fetchall()

    print(f"Total clientes: {len(rows):,}")

    customers = []
    for r in rows:
        customers.append({
            "id":      str(r[0]),
            "name":    r[1] or "",
            "email":   (r[2] or "").lower().strip(),
            "phone":   normalize_phone(r[3] or ""),
            "city":    (r[4] or "").upper().strip(),
            "doc":     (r[5] or "").strip(),
            "norm":    normalize_name(r[1] or ""),
        })

    # ── Bloque 1: Email exacto ────────────────────────────────────────────────
    email_groups: dict[str, list[str]] = defaultdict(list)
    for c in customers:
        if c["email"] and "@" in c["email"]:
            email_groups[c["email"]].append(c["id"])

    merge_map: dict[str, tuple[str, str, float]] = {}  # from_id → (to_id, method, score)

    for email, ids in email_groups.items():
        if len(ids) < 2:
            continue
        canonical = ids[0]
        for dup in ids[1:]:
            if dup not in merge_map:
                merge_map[dup] = (canonical, "email_exact", 100.0)

    print(f"Duplicados por email exacto:    {len(merge_map):,}")

    # ── Bloque 2: Teléfono exacto + misma ciudad ──────────────────────────────
    phone_city_groups: dict[tuple, list[str]] = defaultdict(list)
    for c in customers:
        if c["phone"] and len(c["phone"]) >= 7 and c["city"]:
            phone_city_groups[(c["phone"], c["city"])].append(c["id"])

    b2_count = 0
    for key, ids in phone_city_groups.items():
        if len(ids) < 2:
            continue
        canonical = ids[0]
        for dup in ids[1:]:
            if dup not in merge_map:
                merge_map[dup] = (canonical, "phone_city", 100.0)
                b2_count += 1

    print(f"Duplicados por teléfono+ciudad: {b2_count:,}")

    # ── Bloque 3: Nombre similar + ciudad (Jaro-Winkler) ─────────────────────
    b3_count = 0
    if HAVE_RAPIDFUZZ:
        # Agrupar por ciudad para reducir comparaciones O(n²)
        city_bucket: dict[str, list[dict]] = defaultdict(list)
        for c in customers:
            if c["id"] not in merge_map:
                city_bucket[c["city"]].append(c)

        for city, bucket in city_bucket.items():
            if len(bucket) < 2:
                continue
            for i in range(len(bucket)):
                for j in range(i + 1, len(bucket)):
                    a, b = bucket[i], bucket[j]
                    if a["id"] in merge_map or b["id"] in merge_map:
                        continue
                    if not a["norm"] or not b["norm"]:
                        continue
                    score = JaroWinkler.similarity(a["norm"], b["norm"]) * 100
                    if score >= min_score:
                        merge_map[b["id"]] = (a["id"], "name_city_jw", round(score, 2))
                        b3_count += 1

    print(f"Duplicados por nombre+ciudad JW>={min_score}: {b3_count:,}")
    print(f"Total merges propuestos:        {len(merge_map):,}")

    if dry_run:
        print("\n[DRY RUN] Muestra de merges:")
        id_to_name = {c["id"]: c["name"] for c in customers}
        for from_id, (to_id, method, score) in list(merge_map.items())[:20]:
            print(f"  {id_to_name.get(from_id,'?'):35s} → {id_to_name.get(to_id,'?'):35s}  [{method} {score:.0f}]")
        conn.close()
        return {"proposed": len(merge_map), "by_email": len(merge_map) - b2_count - b3_count, "by_phone": b2_count, "by_name_jw": b3_count}

    # ── Aplicar: insertar merge_map ──────────────────────────────────────────
    with conn.cursor() as cur:
        for from_id, (to_id, method, score) in merge_map.items():
            cur.execute("""
                INSERT INTO simora_v2.customer_merge_map (from_id, to_id, method, score)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (from_id) DO NOTHING
            """, [from_id, to_id, method, score])

    # ── Actualizar fact_orders.customer_id ────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            UPDATE simora_v2.fact_orders fo
            SET customer_id = mm.to_id
            FROM simora_v2.customer_merge_map mm
            WHERE fo.customer_id = mm.from_id
        """)
        orders_updated = cur.rowcount

        cur.execute("""
            UPDATE simora_v2.fact_guides fg
            SET customer_id = mm.to_id
            FROM simora_v2.customer_merge_map mm
            WHERE fg.customer_id = mm.from_id
        """)
        guides_updated = cur.rowcount

    conn.commit()

    print(f"\nfact_orders actualizados: {orders_updated:,}")
    print(f"fact_guides actualizados: {guides_updated:,}")

    # ── Verificación ─────────────────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(DISTINCT to_id) FROM simora_v2.customer_merge_map")
        canonical_count = cur.fetchone()[0]
        cur.execute("SELECT COUNT(*) FROM simora_v2.customer_merge_map")
        total_mapped = cur.fetchone()[0]

    unique_after = len(customers) - total_mapped
    print(f"\nClientes únicos efectivos: ~{unique_after:,} (de {len(customers):,} registros)")
    print(f"Reducción: {round(total_mapped/len(customers)*100,1)}%")

    conn.close()
    return {
        "total_raw": len(customers),
        "merges_applied": total_mapped,
        "unique_effective": unique_after,
        "orders_updated": orders_updated,
        "by_email": len(merge_map) - b2_count - b3_count,
        "by_phone_city": b2_count,
        "by_name_jw": b3_count,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run",   action="store_true")
    parser.add_argument("--min-score", type=int, default=92)
    args = parser.parse_args()
    run(args.dry_run, args.min_score)
