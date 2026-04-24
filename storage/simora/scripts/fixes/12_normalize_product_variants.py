"""
Fix 12: Normalización de variantes en dim_products
===================================================
Agrega 4 columnas para modelar la relación producto canónico → variante/instancia,
SIN tocar fact_order_items (la FK product_id se preserva intacta).

  product_type      VARCHAR(20)  — kit | unit | variant_master | variant_instance
  canonical_id      UUID         — variant_master: apunta a sí mismo
                                   variant_instance: apunta al maestro novalogic
                                   kit / unit: NULL
  variant_attribute VARCHAR(30)  — 'Color' | 'Aroma'
  variant_value     VARCHAR(80)  — 'Kiwi' | 'Coral' | 'Batido de fresa X12' …

Lógica:
  - Productos Novalogic: productType del API (kit→kit, unit→unit, variant→variant_master)
  - 4 variant_masters identificados en Novalogic (Esmalte de color, Vela hidratante corporal,
    Cosmetiquera encantada, Exfoliante corporal con vitaminas)
  - Productos legacy que corresponden a variantes de esos 4 maestros → variant_instance
  - Resto de productos legacy: kit o unit según categoria existente

Uso:
  python 12_normalize_product_variants.py --dry-run
  python 12_normalize_product_variants.py
"""

import sys
import re
import json
import argparse
import unicodedata
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db


def norm(s: str) -> str:
    s = str(s).lower().strip()
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")


# ── Novalogic API → dim_products source_id mapping ──────────────────────────
# productType del API: 'kit' | 'unit' | 'variant'
NOVALOGIC_PRODUCT_TYPES = {
    # kits
    "34273725-c0f6-4409-8143-4282f691db7c": "kit",   # Caja poderosa
    "33c602cd-069c-4b66-900e-5aa3db7e1fd0": "kit",   # Algodón pequeño 10 gr X2
    "c6013c2c-2f76-4801-93ee-5be72f6436af": "kit",   # Piedra pómez mini X6 (kit)
    "1e9b0548-f7e6-4f16-884c-2eef081947d5": "kit",   # Lima de agua X6
    "2966ee7a-6055-42ad-aa6b-85afc00f88e8": "kit",   # Kit de Limpieza Cuidado Total
    "a34aa816-5d79-46f1-a85b-75b4864ab75e": "kit",   # Kit de limpieza full
    "09eca1e2-6e8f-4338-8573-6db5830dbed9": "kit",   # Kit de limpieza express
    "aa3bbf4a-d540-44c8-b5e6-38621ff1adc3": "kit",   # Kit de limpieza pro
    "cdaac18a-f1e7-4407-9fa6-2325b171b6b3": "kit",   # Kit dúo hidratante
    "7e920c2a-c9a9-4bcc-8ac1-6345091873c7": "kit",   # Magibella X5 (Con Base Endurecedora)
    "86600918-a813-4200-ad3d-1626ca91cf2b": "kit",   # Kit navideño edición cascanueces
    "1824cbab-ddbd-4bda-b968-e2a9ac8fcb1b": "kit",   # Kit cuidado total
    "bc89f655-602d-462c-ba2d-c7c8cd0c43d7": "kit",   # Kit relámpago
    "a04a0ed9-8f6c-4242-9f98-196a3d7d617b": "kit",   # Magibella (x5)
    "88b2e2b4-f3e3-4ddd-9623-d8e262f4d957": "kit",   # Magibella (x3)
    "955dd871-df27-4c16-8258-92fc08e29176": "kit",   # Kit amigas Magibell
    "81acf8e8-496b-4605-b29a-68aba7a444f6": "kit",   # Kit uñas de acero Magibell
    "ce264522-f16d-48f5-8ca9-d833a7fa065a": "kit",   # Kit divinas Magibell
    "af714a3d-ded9-4e09-9f86-ba415634f398": "kit",   # Kit uñas bonitas
    "0374d7d7-26e7-476e-9bfb-c1bceb40a4c8": "kit",   # Kit uñas perfectas Magibell
    # variants (maestros)
    "368fb371-2092-4b03-83c7-9f2cb744f172": "variant",  # Cosmetiquera encantada
    "571c2f6a-cff5-462e-81b7-3c20049cb75e": "variant",  # Vela hidratante corporal
    "1a685e05-a161-4016-b7d7-6b5009394aa8": "variant",  # Exfoliante corporal con vitaminas
    "716d80b3-7dfc-4cd7-bbfc-ae49c4ef1971": "variant",  # Esmalte de color
    # units (rest are unit by default — listed explicitly for clarity)
}

# ── Variant masters: source_id → (dim_product_id se busca en BD, attribute) ─
# dim_products IDs de los 4 maestros (source=novalogic)
VARIANT_MASTERS_BY_SOURCE_ID = {
    "716d80b3-7dfc-4cd7-bbfc-ae49c4ef1971": "Color",    # Esmalte de color
    "571c2f6a-cff5-462e-81b7-3c20049cb75e": "Aroma",    # Vela hidratante corporal
    "368fb371-2092-4b03-83c7-9f2cb744f172": "Color",    # Cosmetiquera encantada
    "1a685e05-a161-4016-b7d7-6b5009394aa8": "Aroma",    # Exfoliante corporal con vitaminas
}


def extract_variant_value(name: str, master_name: str) -> str:
    """Extrae el valor de variante quitando el prefijo del producto maestro."""
    n = name.strip()
    mn = master_name.strip()
    # Intenta quitar el nombre maestro como prefijo directo
    if n.lower().startswith(mn.lower()):
        rest = n[len(mn):].strip(" ,-")
        return rest if rest else n

    # Reglas específicas por maestro
    mn_norm = norm(mn)

    if "esmalte de color" in mn_norm:
        # "Esmalte Batido de fresa" → "Batido de fresa"
        prefix_len = n.lower().find("esmalte ") + len("esmalte ")
        if prefix_len > len("esmalte ") - 1:
            val = n[prefix_len:].strip()
            return val[0].upper() + val[1:] if val else val

    if "vela hidratante corporal" in mn_norm:
        # "Vela hidratante corporal Kiwi" → "Kiwi"
        # "Vela hidratante corporal Kiwi (mayorista) X12" → "Kiwi X12"
        m = re.match(r"^vela hidratante corporal\s+(.+)$", n, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            # Normalizar "(mayorista) X12" → "X12"
            val = re.sub(r"\(mayorist[ao]\)\s*", "", val, flags=re.IGNORECASE).strip()
            val = re.sub(r"\s+", " ", val)
            return val
        # "Vela Kiwi" (short form)
        m = re.match(r"^vela\s+(.+)$", n, re.IGNORECASE)
        if m:
            return m.group(1).strip()

    if "cosmetiquera encantada" in mn_norm:
        # "Cosmetiquera azul cielo" → "Azul cielo"
        m = re.match(r"^cosmetiquera\s+(.+)$", n, re.IGNORECASE)
        if m:
            return m.group(1).strip().capitalize()

    if "exfoliante corporal con vitaminas" in mn_norm:
        # "Exfoliante frutos rojos" / "Exfoliante de frutos rojos" → "Frutos rojos"
        m = re.match(r"^exfoliante\s+(?:de\s+)?(.+?)(?:\s*\(x\d+\))?$", n, re.IGNORECASE)
        if m:
            val = m.group(1).strip()
            # Normalizar typos (Frutos rojos / frutos rojos)
            return val.capitalize()

    return n


def is_esmalte_variant(n: str) -> bool:
    """True si es esmalte de color individual (no profesional, no mayorista bulk)."""
    if not n.startswith("esmalte "):
        return False
    # Excluir: esmalte de color (maestro), esmalte profesional (bulk)
    if "profesional" in n or n == "esmalte de color":
        return False
    return True


def is_vela_variant(n: str) -> bool:
    if not n.startswith("vela "):
        return False
    return True


def is_cosmetiquera_variant(n: str) -> bool:
    if not n.startswith("cosmetiquera "):
        return False
    if "encantada" in n:
        return False  # Es el maestro
    return True


def is_exfoliante_variant(n: str) -> bool:
    if not n.startswith("exfoliante "):
        return False
    # Excluir "exfoliante corporal" (son novalogic unit)
    if "corporal" in n:
        return False
    return True


def classify_product(pid: str, name: str, source: str, categoria: str,
                     masters: dict) -> tuple:
    """
    Retorna (product_type, canonical_id, variant_attribute, variant_value).
    masters: { source_id_maestro: (dim_id_maestro, attribute, master_name) }
    """
    n = norm(name)

    # ── Productos Novalogic ──────────────────────────────────────────────────
    if source == "novalogic":
        api_type = NOVALOGIC_PRODUCT_TYPES.get(str(pid), "unit")
        if api_type == "variant":
            return ("variant_master", str(pid), None, None)
        elif api_type == "kit":
            return ("kit", None, None, None)
        else:
            return ("unit", None, None, None)

    # ── Productos Legacy ─────────────────────────────────────────────────────
    # Buscar si es variante de algún maestro
    for src_id, (master_dim_id, attribute, master_name) in masters.items():
        matched = False
        if "esmalte de color" in norm(master_name) and is_esmalte_variant(n):
            matched = True
        elif "vela hidratante corporal" in norm(master_name) and is_vela_variant(n):
            matched = True
        elif "cosmetiquera encantada" in norm(master_name) and is_cosmetiquera_variant(n):
            matched = True
        elif "exfoliante corporal con vitaminas" in norm(master_name) and is_exfoliante_variant(n):
            matched = True

        if matched:
            val = extract_variant_value(name, master_name)
            return ("variant_instance", master_dim_id, attribute, val)

    # No es variante → kit o unit según categoria
    if categoria == "kit":
        return ("kit", None, None, None)
    return ("unit", None, None, None)


def ensure_columns(conn):
    with conn.cursor() as cur:
        cur.execute("""
            ALTER TABLE simora_v2.dim_products
              ADD COLUMN IF NOT EXISTS product_type      VARCHAR(20),
              ADD COLUMN IF NOT EXISTS canonical_id      UUID,
              ADD COLUMN IF NOT EXISTS variant_attribute VARCHAR(30),
              ADD COLUMN IF NOT EXISTS variant_value     VARCHAR(80)
        """)
    conn.commit()


def run(dry_run: bool):
    conn = simora_db.get_conn()
    ensure_columns(conn)

    # ── Cargar todos los productos ────────────────────────────────────────────
    with conn.cursor() as cur:
        cur.execute("""
            SELECT id, source_id, name, source::text, categoria
            FROM simora_v2.dim_products
        """)
        products = cur.fetchall()
    print(f"Productos cargados: {len(products)}")

    # ── Construir mapa de maestros: source_id → (dim_id, attribute, name) ────
    masters = {}
    for pid, src_id, name, source, cat in products:
        if source == "novalogic" and str(src_id) in VARIANT_MASTERS_BY_SOURCE_ID:
            attribute = VARIANT_MASTERS_BY_SOURCE_ID[str(src_id)]
            masters[str(src_id)] = (str(pid), attribute, name)

    print(f"Variant masters encontrados: {len(masters)}")
    for sid, (did, attr, nm) in masters.items():
        print(f"  {nm} [{attr}] → dim_id={did[:8]}...")

    # ── Clasificar todos los productos ───────────────────────────────────────
    classified = []
    for pid, src_id, name, source, categoria in products:
        pt, cid, vattr, vval = classify_product(
            src_id or pid, name, source, categoria or "", masters
        )
        classified.append((str(pid), pt, cid, vattr, vval, name, source))

    # ── Preview ───────────────────────────────────────────────────────────────
    from collections import Counter
    dist = Counter(pt for _, pt, *_ in classified)
    print("\n=== DISTRIBUCIÓN PROPUESTA ===")
    for pt, n in sorted(dist.items()):
        print(f"  {pt:<20} {n:>4}")

    variant_instances = [(pid, pt, cid, vattr, vval, nm, src)
                         for pid, pt, cid, vattr, vval, nm, src in classified
                         if pt == "variant_instance"]
    print(f"\n=== VARIANT INSTANCES ({len(variant_instances)}) ===")
    # Agrupar por canonical
    by_master = defaultdict(list)
    for pid, pt, cid, vattr, vval, nm, src in variant_instances:
        master_name = next((nm2 for _, (did, _, nm2) in masters.items() if did == cid), cid)
        by_master[master_name].append((nm, vval, src))

    for master_nm, items in sorted(by_master.items()):
        print(f"\n  → {master_nm}")
        for nm, vval, src in sorted(items):
            print(f"    [{src[:1].upper()}] {nm:<55}  → '{vval}'")

    if dry_run:
        print("\n[DRY RUN] No se escriben cambios.")
        conn.close()
        return {"dry_run": True, "distribution": dict(dist),
                "variant_instances": len(variant_instances)}

    # ── Actualizar ────────────────────────────────────────────────────────────
    print(f"\nActualizando dim_products...")
    updated = 0
    BATCH = 200
    with conn.cursor() as cur:
        for i in range(0, len(classified), BATCH):
            batch = classified[i:i + BATCH]
            for pid, pt, cid, vattr, vval, _, _ in batch:
                cur.execute("""
                    UPDATE simora_v2.dim_products
                    SET product_type      = %s,
                        canonical_id      = %s,
                        variant_attribute = %s,
                        variant_value     = %s
                    WHERE id = %s
                      AND (product_type      IS DISTINCT FROM %s
                        OR canonical_id      IS DISTINCT FROM %s::uuid
                        OR variant_attribute IS DISTINCT FROM %s
                        OR variant_value     IS DISTINCT FROM %s)
                """, [pt, cid, vattr, vval, pid,
                      pt, cid, vattr, vval])
                updated += cur.rowcount
    conn.commit()
    print(f"  Filas actualizadas: {updated}")

    # ── Estado final con revenue por producto canónico ────────────────────────
    print("\n=== REVENUE AGRUPADO POR PRODUCTO CANÓNICO ===")
    with conn.cursor() as cur:
        cur.execute("""
            SELECT
              COALESCE(canon.name, p.name)  AS producto_canonico,
              p.variant_attribute,
              COUNT(DISTINCT p.id)           AS variantes,
              COUNT(foi.id)                  AS order_lines,
              COALESCE(SUM(foi.total), 0)    AS revenue
            FROM simora_v2.dim_products p
            LEFT JOIN simora_v2.dim_products canon
                   ON canon.id = p.canonical_id AND canon.id != p.id
            LEFT JOIN simora_v2.fact_order_items foi ON foi.product_id = p.id
            GROUP BY COALESCE(canon.name, p.name), p.variant_attribute
            ORDER BY revenue DESC NULLS LAST
            LIMIT 30
        """)
        print(f"  {'Producto canónico':<55} {'Attr':<8} {'SKUs':>5}  {'Líneas':>8}  {'Revenue':>16}")
        print("  " + "-"*100)
        for row in cur.fetchall():
            rev = int(row[4]) if row[4] else 0
            attr = str(row[1]) if row[1] else "-"
            print(f"  {str(row[0]):<55} {attr:<8} {int(row[2]):>5}  "
                  f"{int(row[3] or 0):>8,}  {rev:>16,}")

    # ── Bitácora ──────────────────────────────────────────────────────────────
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
                "Fix 12: product_type y canonical_id normalizados en dim_products",
                (
                    f"Normalizacion de variantes en {len(products)} productos. "
                    f"4 variant_masters identificados en Novalogic: "
                    f"Esmalte de color (Color), Vela hidratante corporal (Aroma), "
                    f"Cosmetiquera encantada (Color), Exfoliante corporal con vitaminas (Aroma). "
                    f"Distribucion: {dict(dist)}. "
                    f"fact_order_items.product_id no modificado — FK intacta."
                ),
                ["fix", "productos", "variantes", "normalizacion"],
                "12_normalize_product_variants.py",
                len(products),
                "resolved",
            ])
        conn.commit()
        print("\nBitácora actualizada.")
    except Exception as e:
        print(f"\n[!] Error en bitácora: {e}")

    conn.close()
    return {
        "total": len(products),
        "updated": updated,
        "distribution": dict(dist),
        "variant_instances": len(variant_instances),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = run(args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
