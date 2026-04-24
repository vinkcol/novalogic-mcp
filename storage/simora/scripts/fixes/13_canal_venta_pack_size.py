"""
Fix 13: Canal de venta y tamaño de paquete en dim_products
==========================================================
Agrega dos columnas para modelar la dimensión mayorista/retail:

  canal_venta  VARCHAR(10)  — 'retail' | 'mayorista'
  pack_size    SMALLINT     — unidades por paquete (1 = retail unitario)

Reglas de detección:
  - Nombre contiene 'mayorist' (cualquier capitalización)
      → mayorista, pack_size extraído del número X en el nombre
  - Nombre contiene '(xN)' en minúsculas (notación legacy)
      → mayorista, pack_size = N
  - Resto → retail, pack_size = 1

Canonical_id para mayoristas sin variante:
  Se intenta enlazar al producto base (retail/novalogic) eliminando el sufijo
  mayorista del nombre y buscando coincidencia normalizada en dim_products.
  Si no hay match exacto → canonical_id queda NULL.

Nota: Los variant_instance ya tienen canonical_id seteado por Fix 12.
      Fix 13 sólo actualiza canonical_id donde aún es NULL y hay match.

Uso:
  python 13_canal_venta_pack_size.py --dry-run
  python 13_canal_venta_pack_size.py
"""

import sys
import re
import json
import argparse
import unicodedata
from pathlib import Path
from collections import defaultdict, Counter

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def norm(s: str) -> str:
    s = str(s).lower().strip()
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")


def detect_mayorista(name: str) -> tuple:
    """
    Retorna (canal_venta, pack_size).
    pack_size = None si es mayorista sin número explícito.
    """
    n = name.strip()

    # Patron 1: (mayorista X12) / (Mayoristas X6) / (mayoristaX12)
    m = re.search(r'mayorist[ao]s?\s*\)?\s*X\s*(\d+)', n, re.IGNORECASE)
    if m:
        return ('mayorista', int(m.group(1)))

    # Patron 2: (mayorista) X12  — paréntesis cierra antes del número
    m = re.search(r'mayorist[ao]s?\)\s*X\s*(\d+)', n, re.IGNORECASE)
    if m:
        return ('mayorista', int(m.group(1)))

    # Patron 3: (x12) o (x12 mayorista) o (x12) mayorista — notación legacy lowercase
    # EXCLUIR: nombres con "obsequio" donde el (xN) es cantidad del regalo, no del paquete
    if 'obsequio' not in n.lower():
        m = re.search(r'\(x(\d+)(?:\s+mayorist[ao]s?)?\)', n, re.IGNORECASE)
        if m:
            return ('mayorista', int(m.group(1)))

    # Patron 4: "X12) mayorista" al final
    m = re.search(r'x(\d+)\)\s+mayorist[ao]s?\s*$', n, re.IGNORECASE)
    if m:
        return ('mayorista', int(m.group(1)))

    # Patron 5: "mayorista" solo sin número
    if re.search(r'mayorist[ao]', n, re.IGNORECASE):
        return ('mayorista', None)

    return ('retail', 1)


MAYORISTA_STRIP_PATTERNS = [
    r'\s*\(mayorist[ao]s?\s+X\s*\d+\)',       # (mayorista X12)
    r'\s*\(mayorist[ao]s?X\s*\d+\)',           # (mayoristaX12) sin espacio
    r'\s*\(mayorist[ao]s?\)\s*X\s*\d+',        # (mayorista) X12
    r'\s*\(mayorist[ao]s?\)',                    # (mayorista)
    r'\s*\(x\d+\s+mayorist[ao]s?\)',            # (x12 mayorista)
    r'\s*\(x\d+\)\s*mayorist[ao]s?',            # (x10) mayorista
    r'\s*\(x\d+\)',                              # (x10) legacy
    r'\s+mayorist[ao]s?$',                       # trailing "mayorista"
    r'\s+X\d+$',                                 # trailing " X12"
]


def strip_mayorista_suffix(name: str) -> str:
    n = name.strip()
    for pattern in MAYORISTA_STRIP_PATTERNS:
        n = re.sub(pattern, '', n, flags=re.IGNORECASE).strip()
    return n.strip()


def ensure_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.dim_products
              ADD COLUMN IF NOT EXISTS canal_venta VARCHAR(10) DEFAULT 'retail',
              ADD COLUMN IF NOT EXISTS pack_size   SMALLINT    DEFAULT 1
        """)
    conn.commit()


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_columns(conn)

    # ── Cargar todos los productos ─────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, name, source::text, product_type, canonical_id
            FROM simora_v2.dim_products
        """)
        products = cur.fetchall()
    print(f"Productos cargados: {len(products)}")

    # ── Construir mapa nombre_normalizado → dim_id para novalogic retail ──
    # Para enlazar mayoristas legacy a su equivalente retail en novalogic
    novalogic_retail = {}
    for pid, name, source, ptype, cid in products:
        if source == "novalogic" and ptype in ("unit", "variant_master", None):
            novalogic_retail[norm(name.strip())] = str(pid)

    print(f"Productos novalogic retail indexados: {len(novalogic_retail)}")

    # ── Clasificar ────────────────────────────────────────────────────────
    classified = []
    for pid, name, source, ptype, existing_cid in products:
        canal, pack = detect_mayorista(name)

        # Intentar enlazar canonical_id para mayoristas sin canonical previo
        new_canonical = None
        if canal == 'mayorista' and existing_cid is None:
            base_name = strip_mayorista_suffix(name)
            base_norm = norm(base_name)
            if base_norm in novalogic_retail:
                new_canonical = novalogic_retail[base_norm]

        classified.append((str(pid), name, source, canal, pack, new_canonical, existing_cid))

    # ── Preview ───────────────────────────────────────────────────────────
    mayoristas = [(pid, nm, src, pack, nc)
                  for pid, nm, src, canal, pack, nc, _ in classified
                  if canal == 'mayorista']
    retailes   = [(pid, nm, src)
                  for pid, nm, src, canal, *_ in classified
                  if canal == 'retail']

    pack_dist = Counter(pack for _, _, _, _, pack, _, _ in classified if _ == 'mayorista'
                        or classified[0][3] == 'mayorista')
    # simpler:
    pack_dist = Counter(
        pack for _, _, _, canal, pack, _, _ in classified if canal == 'mayorista'
    )

    print(f"\n=== DISTRIBUCIÓN ===")
    print(f"  retail    : {len(retailes):>4}")
    print(f"  mayorista : {len(mayoristas):>4}")
    print(f"\n  pack_size distribution (mayorista):")
    for ps, n in sorted(pack_dist.items(), key=lambda x: (x[0] is None, x[0])):
        ps_str = str(ps) if ps else "? (sin número)"
        print(f"    X{ps_str:<6} → {n} productos")

    # Mayoristas con canonical resuelto
    with_canon = [(nm, strip_mayorista_suffix(nm), nc)
                  for _, nm, _, canal, _, nc, _ in classified
                  if canal == 'mayorista' and nc]
    print(f"\n=== MAYORISTAS CON CANONICAL RESUELTO ({len(with_canon)}) ===")
    for nm, base, cid in sorted(with_canon):
        print(f"  '{nm}'")
        print(f"    → base: '{base}'  canonical_id: {cid[:8]}...")

    without_canon = [(nm,)
                     for _, nm, _, canal, _, nc, existing in classified
                     if canal == 'mayorista' and nc is None and existing is None]
    if without_canon:
        print(f"\n=== MAYORISTAS SIN CANONICAL ({len(without_canon)}) ===")
        for (nm,) in sorted(without_canon):
            base = strip_mayorista_suffix(nm)
            print(f"  '{nm}' → base: '{base}' [sin match]")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        conn.close()
        return {
            "dry_run": True,
            "retail": len(retailes),
            "mayorista": len(mayoristas),
            "mayorista_with_canonical": len(with_canon),
        }

    # ── Actualizar ────────────────────────────────────────────────────────
    print(f"\nActualizando dim_products...")
    updated = 0
    BATCH = 200
    with conn.cursor() as cur:
        for i in range(0, len(classified), BATCH):
            batch = classified[i:i + BATCH]
            for pid, _, _, canal, pack, new_canonical, existing_cid in batch:
                pack_val = pack if pack is not None else 1

                # canonical_id: mantener el existente si ya hay uno (de Fix 12)
                canonical_update = new_canonical if (new_canonical and not existing_cid) else existing_cid

                cur.execute("""
                    UPDATE simora_v2.dim_products
                    SET canal_venta = %s,
                        pack_size   = %s,
                        canonical_id = COALESCE(canonical_id, %s::uuid)
                    WHERE id = %s
                      AND (canal_venta IS DISTINCT FROM %s
                        OR pack_size   IS DISTINCT FROM %s)
                """, [canal, pack_val, new_canonical,
                      pid, canal, pack_val])
                updated += cur.rowcount
    conn.commit()
    print(f"  Filas actualizadas: {updated}")

    # ── Estado final ───────────────────────────────────────────────────────
    print("\n=== ESTADO FINAL ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              canal_venta,
              pack_size,
              COUNT(*)                        AS productos,
              COUNT(foi.id)                   AS order_lines,
              COALESCE(SUM(foi.total), 0)     AS revenue,
              ROUND(AVG(p.unit_price)::numeric, 0) AS avg_price
            FROM simora_v2.dim_products p
            LEFT JOIN simora_v2.fact_order_items foi ON foi.product_id = p.id
            GROUP BY canal_venta, pack_size
            ORDER BY canal_venta, pack_size
        """)
        print(f"  {'canal':<12} {'pack':>5}  {'SKUs':>5}  {'líneas':>8}  {'revenue':>16}  {'avg_price':>10}")
        print("  " + "-"*70)
        for row in cur.fetchall():
            rev = int(row[4]) if row[4] else 0
            avg = int(row[5]) if row[5] else 0
            print(f"  {str(row[0]):<12} {'X'+str(row[1]):>5}  {int(row[2]):>5}  "
                  f"{int(row[3] or 0):>8,}  {rev:>16,}  {avg:>10,}")

    # ── Precio unitario efectivo por canal ────────────────────────────────
    print("\n=== PRECIO UNITARIO EFECTIVO (revenue / pack_size) ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COALESCE(canon.name, p.name)        AS producto,
              p.canal_venta,
              p.pack_size,
              p.unit_price,
              ROUND((p.unit_price::numeric / NULLIF(p.pack_size, 0)), 0) AS precio_x_unidad,
              COUNT(foi.id)                        AS lineas,
              COALESCE(SUM(foi.total), 0)          AS revenue
            FROM simora_v2.dim_products p
            LEFT JOIN simora_v2.dim_products canon ON canon.id = p.canonical_id AND canon.id != p.id
            LEFT JOIN simora_v2.fact_order_items foi ON foi.product_id = p.id
            WHERE p.canal_venta = 'mayorista'
              AND p.unit_price > 0
            GROUP BY COALESCE(canon.name, p.name), p.canal_venta, p.pack_size, p.unit_price
            ORDER BY COALESCE(canon.name, p.name), p.pack_size
        """)
        print(f"  {'Producto':<48} {'X':>4}  {'unit_price':>10}  {'p/unidad':>10}  {'líneas':>7}  {'revenue':>14}")
        print("  " + "-"*100)
        for row in cur.fetchall():
            rev = int(row[6]) if row[6] else 0
            pu = int(row[4]) if row[4] else 0
            up = int(row[3]) if row[3] else 0
            print(f"  {str(row[0]):<48} X{int(row[2]):<3}  {up:>10,}  {pu:>10,}  "
                  f"{int(row[5] or 0):>7,}  {rev:>14,}")

    # ── Bitácora ───────────────────────────────────────────────────────────
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
                "low",
                "Fix 13: canal_venta y pack_size poblados en dim_products",
                (
                    f"Dimension mayorista/retail en {len(products)} productos. "
                    f"retail={len(retailes)}, mayorista={len(mayoristas)}. "
                    f"Pack sizes: {dict(pack_dist)}. "
                    f"canonical_id resuelto para {len(with_canon)} mayoristas. "
                    f"Reglas: nombre contiene 'mayorist' o '(xN)' → mayorista."
                ),
                ["fix", "productos", "canal_venta", "mayorista", "pack_size"],
                "13_canal_venta_pack_size.py",
                len(mayoristas),
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "retail": len(retailes),
        "mayorista": len(mayoristas),
        "mayorista_with_canonical": len(with_canon),
        "pack_size_dist": {str(k): v for k, v in pack_dist.items()},
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
