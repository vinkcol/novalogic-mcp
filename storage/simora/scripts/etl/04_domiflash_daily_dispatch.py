"""
ETL 04: Domiflash planillas diarias → fact_dispatch_log
=========================================================
Fuente : OneDrive  CONTROL INTERNO / Área_Logística Simora /
                   2. Control Servicio Logistico /
                   1. Distribución Local - Domiflash / {año} / {mes} / YYYY-MM-DD.xlsx

Destino: simora_v2.fact_dispatch_log

Columnas del archivo diario (Domiflash):
  _id, fechaEntrega, guia, nombres, celular,
  departamento, ciudad, localidad, barrio, direccion,
  subtotal, envio, total, medioPago, infoAdic, horario

Valor de negocio:
  - Fuente de verdad de lo que Simora le entregó a Domiflash para despachar
  - Permite cruzar dispatch vs entrega confirmada (courier_reports)
  - guia → fact_guides linkage
  - _id  → fact_orders.source_id linkage (pedidos legacy)
  - medioPago → enriquece clasificación de pagos

Estrategia de descarga:
  - Usa el access_token de MS almacenado en
    storage/simora/integrations/.microsoft.tokens.enc
  - Descifra AES-256-GCM con MCP_TOKEN_ENCRYPTION_KEY del .env
  - Descarga cada archivo directamente en memoria (no toca disco)
  - Idempotente: ON CONFLICT (source_file, guide_number) DO UPDATE

Uso:
  python 04_domiflash_daily_dispatch.py --dry-run
  python 04_domiflash_daily_dispatch.py --year 2024
  python 04_domiflash_daily_dispatch.py --year 2025
  python 04_domiflash_daily_dispatch.py               # todos los años
"""

import sys
import io
import json
import base64
import argparse
import time
from pathlib import Path
from datetime import datetime, timezone

import requests
import openpyxl
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

# ── Config ────────────────────────────────────────────────────────────────────
GRAPH_BASE = "https://graph.microsoft.com/v1.0"
STORAGE    = Path(__file__).parent.parent.parent  # storage/simora/

# IDs de las carpetas de años en "1. Distribución Local - Domiflash"
# Obtenidos via Graph API en la sesión de análisis
YEAR_FOLDER_IDS = {
    # 2023 está dentro del mismo item padre (01NXFPQLJPIAD2HBJ4BVGY5GKPAGBSH7ES)
    "2023_dist": "01NXFPQLJPIAD2HBJ4BVGY5GKPAGBSH7ES",
    "2024_dist": "01NXFPQLJSDELEN63DKRCZKO6KWXIVCCXZ",
    "2025_dist": "01NXFPQLJOWZFOACDZGFEZAVRDXG5F2D24",
    "2026_dist": "01NXFPQLLJWAOGZHXUWVHKTGVB22LBHJ3Q",
}

MES_MAP = {
    "Enero": 1, "Febrero": 2, "Marzo": 3, "Abril": 4,
    "Mayo": 5, "Junio": 6, "Julio": 7, "Agosto": 8,
    "Septiembre": 9, "Octubre": 10, "Noviembre": 11, "Diciembre": 12,
}

BATCH_SIZE = 200


# ── Token MS ──────────────────────────────────────────────────────────────────

def load_env_key() -> bytes:
    """Lee MCP_TOKEN_ENCRYPTION_KEY del .env del proyecto MCP."""
    env_file = STORAGE.parent.parent / "novalogic-mcp" / ".env"
    if not env_file.exists():
        # Busca en el directorio padre
        for p in [Path(__file__).parent.parent.parent.parent / "novalogic-mcp" / ".env",
                  Path("C:/Users/Usuario/Documents/library/proyectos-2/novalogic/novalogic-mcp/.env")]:
            if p.exists():
                env_file = p
                break
    key_hex = None
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            if line.startswith("MCP_TOKEN_ENCRYPTION_KEY="):
                key_hex = line.strip().split("=", 1)[1]
                break
    if not key_hex:
        raise RuntimeError("MCP_TOKEN_ENCRYPTION_KEY no encontrado en .env")
    return bytes.fromhex(key_hex)


def decrypt_tokens(key: bytes, slug: str) -> dict:
    """Descifra el archivo .microsoft.tokens.enc con AES-256-GCM."""
    token_file = STORAGE / "integrations" / ".microsoft.tokens.enc"
    if not token_file.exists():
        # Buscar en slug-specific path
        token_file = STORAGE.parent / slug / "integrations" / ".microsoft.tokens.enc"
    if not token_file.exists():
        raise FileNotFoundError(f"Token file no encontrado: {token_file}")

    raw  = base64.b64decode(token_file.read_bytes())
    iv   = raw[:12]
    tag  = raw[12:28]
    ct   = raw[28:]
    # AES-256-GCM: ciphertext + tag concatenados para cryptography
    aesgcm  = AESGCM(key)
    plain   = aesgcm.decrypt(iv, ct + tag, None)
    return json.loads(plain.decode("utf-8"))


def get_access_token(slug: str = "simora") -> str:
    key    = load_env_key()
    tokens = decrypt_tokens(key, slug)
    exp    = tokens.get("expires_at", 0) / 1000
    if exp - time.time() < 120:
        raise RuntimeError(
            "Token expirado. Reconecta MCP y usa tenant_ms_auth_refresh."
        )
    return tokens["access_token"]


# ── Graph API helpers ─────────────────────────────────────────────────────────

def graph_list_children(token: str, item_id: str) -> list[dict]:
    url = f"{GRAPH_BASE}/me/drive/items/{item_id}/children"
    params = {"$select": "id,name,size,folder,file", "$top": "200"}
    headers = {"Authorization": f"Bearer {token}"}
    items = []
    while url:
        r = requests.get(url, headers=headers, params=params, timeout=30)
        r.raise_for_status()
        data = r.json()
        items.extend(data.get("value", []))
        url    = data.get("@odata.nextLink")
        params = {}  # solo en primer request
    return items


def graph_download_bytes(token: str, item_id: str) -> bytes:
    url = f"{GRAPH_BASE}/me/drive/items/{item_id}/content"
    r = requests.get(
        url,
        headers={"Authorization": f"Bearer {token}"},
        allow_redirects=True,
        timeout=60,
    )
    r.raise_for_status()
    return r.content


# ── Parser de archivo diario ──────────────────────────────────────────────────
# Formatos soportados:
#   Formato v1 (2023-2025): _id, fechaEntrega, guia, nombres, celular,
#     departamento, ciudad, localidad, barrio, direccion, subtotal, envio,
#     total, medioPago, infoAdic, horario
#   Formato v2 (2026+): ID Pedido, Fecha Entrega, ID Envío, Cédula, Tipo Envío,
#     Cliente, Teléfono, Departamento, Ciudad, Localidad, Barrio, Dirección,
#     Horario, Comentarios Adicionales, Valor Envío, Valor Total

def _normalize_col(s: str) -> str:
    """Lowercase, strip, remove accents for fuzzy column matching."""
    import unicodedata
    s = str(s).lower().strip()
    return unicodedata.normalize("NFD", s).encode("ascii", "ignore").decode("ascii")


def _get_col(rec: dict, *aliases):
    """Return first non-None value matching any alias (normalized)."""
    for alias in aliases:
        v = rec.get(alias)
        if v is not None:
            return v
    return None


def parse_daily_file(content: bytes, filename: str) -> list[dict]:
    wb = openpyxl.load_workbook(io.BytesIO(content), data_only=True, read_only=True)
    ws = wb.worksheets[0]

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []

    # Detectar fila de headers — buscar fila con 'guia', '_id', 'id envio' o 'id pedido'
    GUIDE_MARKERS = {"guia", "_id", "id envio", "id pedido"}
    header_idx = 0
    for i, row in enumerate(rows[:5]):
        cells = {_normalize_col(c) for c in row if c}
        if cells & GUIDE_MARKERS:
            header_idx = i
            break

    headers = [_normalize_col(c) if c else f"col_{j}"
               for j, c in enumerate(rows[header_idx])]

    records = []
    for row in rows[header_idx + 1:]:
        if not row or all(c is None for c in row):
            break
        rec = dict(zip(headers, row))

        # Extraer guia — soporta v1 ('guia') y v2 ('id envio')
        guia_raw = _get_col(rec, "guia", "id envio")
        guia = str(guia_raw or "").strip()
        if not guia or guia.lower() in ("guia", "id envio", ""):
            continue

        def to_float(v):
            if v is None:
                return None
            try:
                return float(str(v).replace(",", "").strip()) or None
            except (ValueError, TypeError):
                return None

        def to_str(v, max_len=None):
            if v is None:
                return None
            s = str(v).strip()
            if max_len and len(s) > max_len:
                return None  # descarta valores corruptos en lugar de truncar
            return s or None

        # Fecha — 'fechaentrega' (v1) o 'fecha entrega' (v2)
        fecha_raw = _get_col(rec, "fechaentrega", "fecha entrega")
        if isinstance(fecha_raw, datetime):
            dispatch_date = fecha_raw.date().isoformat()
        elif fecha_raw:
            s = str(fecha_raw).strip()
            dispatch_date = None
            # Intentar formatos en orden
            for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y", "%d/%m/%y", "%m/%d/%Y"):
                try:
                    dispatch_date = datetime.strptime(s[:10], fmt[:len(s[:10].replace("/","-"))]).date().isoformat()
                    break
                except Exception:
                    pass
            if not dispatch_date:
                # Último recurso: intentar parsear D/M/YYYY o DD/M/YYYY
                try:
                    parts = s.replace("-", "/").split("/")
                    if len(parts) == 3:
                        d, m, y = int(parts[0]), int(parts[1]), int(parts[2])
                        if y < 100:
                            y += 2000
                        from datetime import date as _date
                        dispatch_date = _date(y, m, d).isoformat()
                except Exception:
                    dispatch_date = None
        else:
            dispatch_date = None

        records.append({
            "source_file":    filename,
            "dispatch_date":  dispatch_date,
            "guide_number":   guia[:60],
            # v1: _id (MongoDB ObjectId); v2: id pedido (UUID)
            "mongo_id":       to_str(_get_col(rec, "_id", "id pedido"), max_len=60),
            # v1: nombres; v2: cliente
            "customer_name":  to_str(_get_col(rec, "nombres", "cliente")),
            # v1: celular; v2: telefono
            "phone":          to_str(_get_col(rec, "celular", "telefono")),
            "department":     to_str(rec.get("departamento")),
            "city":           to_str(rec.get("ciudad")),
            "locality":       to_str(rec.get("localidad")),
            "neighborhood":   to_str(rec.get("barrio")),
            # v1: direccion; v2: direccion
            "address":        to_str(rec.get("direccion")),
            "subtotal":       to_float(rec.get("subtotal")),
            # v1: envio; v2: valor envio
            "shipping_cost":  to_float(_get_col(rec, "envio", "valor envio")),
            # v1: total; v2: valor total
            "total":          to_float(_get_col(rec, "total", "valor total")),
            # v1: mediopago; v2: tipo envio
            "payment_method": to_str(_get_col(rec, "mediopago", "tipo envio")),
            # v1: infoadic/infoadicional + horario; v2: comentarios adicionales + horario
            "notes":          to_str(
                _get_col(rec, "infoadicional", "infoadic", "comentarios adicionales")
                or rec.get("horario")
            ),
        })

    return records


# ── DDL ───────────────────────────────────────────────────────────────────────

CREATE_TABLE = """
CREATE TABLE IF NOT EXISTS simora_v2.fact_dispatch_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file     VARCHAR(60)   NOT NULL,
    dispatch_date   DATE,
    guide_number    VARCHAR(30)   NOT NULL,
    mongo_id        VARCHAR(30),
    customer_name   VARCHAR(200),
    phone           VARCHAR(20),
    department      VARCHAR(100),
    city            VARCHAR(100),
    locality        VARCHAR(100),
    neighborhood    VARCHAR(100),
    address         TEXT,
    subtotal        NUMERIC(14,2),
    shipping_cost   NUMERIC(14,2),
    total           NUMERIC(14,2),
    payment_method  VARCHAR(50),
    notes           TEXT,
    imported_at     TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source_file, guide_number)
)
"""

CREATE_INDEXES = [
    "CREATE INDEX IF NOT EXISTS idx_dispatch_guide ON simora_v2.fact_dispatch_log (guide_number)",
    "CREATE INDEX IF NOT EXISTS idx_dispatch_date  ON simora_v2.fact_dispatch_log (dispatch_date)",
    "CREATE INDEX IF NOT EXISTS idx_dispatch_mongo ON simora_v2.fact_dispatch_log (mongo_id)",
]


def ensure_table(conn):
    with conn.cursor() as cur:
        cur.execute(CREATE_TABLE)
        for idx in CREATE_INDEXES:
            cur.execute(idx)
        # Ampliar columnas estrechas en caso de que la tabla ya existiera
        cur.execute("""
            ALTER TABLE simora_v2.fact_dispatch_log
              ALTER COLUMN guide_number   TYPE VARCHAR(60),
              ALTER COLUMN mongo_id       TYPE VARCHAR(60),
              ALTER COLUMN phone          TYPE VARCHAR(40),
              ALTER COLUMN payment_method TYPE VARCHAR(100),
              ALTER COLUMN source_file    TYPE VARCHAR(120)
        """)
    conn.commit()
    print("Tabla fact_dispatch_log lista.")


def upsert_batch(conn, records: list[dict]) -> tuple[int, int]:
    ins = upd = 0
    with conn.cursor() as cur:
        for r in records:
            cur.execute("""
                INSERT INTO simora_v2.fact_dispatch_log
                  (source_file, dispatch_date, guide_number, mongo_id,
                   customer_name, phone, department, city, locality,
                   neighborhood, address, subtotal, shipping_cost, total,
                   payment_method, notes)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                ON CONFLICT (source_file, guide_number) DO UPDATE SET
                  dispatch_date  = EXCLUDED.dispatch_date,
                  mongo_id       = COALESCE(EXCLUDED.mongo_id, fact_dispatch_log.mongo_id),
                  customer_name  = COALESCE(EXCLUDED.customer_name, fact_dispatch_log.customer_name),
                  phone          = COALESCE(EXCLUDED.phone, fact_dispatch_log.phone),
                  department     = COALESCE(EXCLUDED.department, fact_dispatch_log.department),
                  city           = COALESCE(EXCLUDED.city, fact_dispatch_log.city),
                  locality       = COALESCE(EXCLUDED.locality, fact_dispatch_log.locality),
                  neighborhood   = COALESCE(EXCLUDED.neighborhood, fact_dispatch_log.neighborhood),
                  address        = COALESCE(EXCLUDED.address, fact_dispatch_log.address),
                  subtotal       = COALESCE(EXCLUDED.subtotal, fact_dispatch_log.subtotal),
                  shipping_cost  = COALESCE(EXCLUDED.shipping_cost, fact_dispatch_log.shipping_cost),
                  total          = COALESCE(EXCLUDED.total, fact_dispatch_log.total),
                  payment_method = COALESCE(EXCLUDED.payment_method, fact_dispatch_log.payment_method),
                  notes          = COALESCE(EXCLUDED.notes, fact_dispatch_log.notes)
            """, [
                r["source_file"], r["dispatch_date"], r["guide_number"],
                r["mongo_id"], r["customer_name"], r["phone"],
                r["department"], r["city"], r["locality"],
                r["neighborhood"], r["address"], r["subtotal"],
                r["shipping_cost"], r["total"], r["payment_method"], r["notes"],
            ])
            if cur.rowcount == 1:
                ins += 1
            else:
                upd += 1
    conn.commit()
    return ins, upd


# ── Main ──────────────────────────────────────────────────────────────────────

def run(years: list[int], dry_run: bool):
    print(f"Años a procesar: {years}  dry_run={dry_run}")

    token = get_access_token()
    print("Token MS obtenido.")

    conn = simora_db.get_conn()
    ensure_table(conn)

    total_files = total_records = total_ins = total_upd = total_skip = 0

    for year in years:
        key = f"{year}_dist"
        if key not in YEAR_FOLDER_IDS:
            print(f"  [{year}] Sin folder_id configurado — skip")
            continue

        year_folder_id = YEAR_FOLDER_IDS[key]
        print(f"\n=== {year} ===")

        # Listar meses
        month_folders = graph_list_children(token, year_folder_id)
        month_folders = [f for f in month_folders if "folder" in f]
        print(f"  Meses encontrados: {[f['name'] for f in month_folders]}")

        for month_folder in sorted(month_folders, key=lambda f: MES_MAP.get(f["name"], 99)):
            month_name = month_folder["name"]
            month_num  = MES_MAP.get(month_name)
            if not month_num:
                print(f"    [{month_name}] Nombre de mes no reconocido — skip")
                continue

            # Listar archivos diarios
            daily_files = graph_list_children(token, month_folder["id"])
            daily_files = [f for f in daily_files if "file" in f and f["name"].endswith(".xlsx")]
            print(f"  {month_name:12s} ({month_num:02d}): {len(daily_files)} archivos", end="")

            if dry_run:
                print(f"  [DRY RUN]")
                total_files += len(daily_files)
                continue

            month_records = month_ins = month_upd = month_skip = 0

            for daily in sorted(daily_files, key=lambda f: f["name"]):
                filename = f"{daily['name']}"
                try:
                    content = graph_download_bytes(token, daily["id"])
                    records = parse_daily_file(content, filename)
                    if not records:
                        month_skip += 1
                        continue

                    # Insertar en lotes
                    for i in range(0, len(records), BATCH_SIZE):
                        ins, upd = upsert_batch(conn, records[i:i + BATCH_SIZE])
                        month_ins += ins
                        month_upd += upd
                    month_records += len(records)
                    total_files += 1

                except Exception as e:
                    conn.rollback()  # limpiar transacción abortada
                    print(f"\n    [!] Error en {filename}: {e}")
                    month_skip += 1

            print(f"  -> {month_records:,} registros  ins={month_ins}  upd={month_upd}  skip={month_skip}")
            total_records += month_records
            total_ins     += month_ins
            total_upd     += month_upd
            total_skip    += month_skip

    # ── Resumen final ────────────────────────────────────────────────────────
    print(f"\n{'='*50}")
    print(f"Archivos procesados : {total_files:,}")
    print(f"Registros totales   : {total_records:,}")
    print(f"Insertados          : {total_ins:,}")
    print(f"Actualizados        : {total_upd:,}")
    print(f"Errores/skip        : {total_skip:,}")

    if not dry_run:
        # Estadísticas post-carga
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM simora_v2.fact_dispatch_log")
            total_in_db = cur.fetchone()[0]
            cur.execute("""
                SELECT COUNT(DISTINCT guide_number)
                FROM simora_v2.fact_dispatch_log dl
                WHERE EXISTS (
                    SELECT 1 FROM simora_v2.fact_courier_reports cr
                    WHERE cr.guide_number = dl.guide_number
                )
            """)
            matched_courier = cur.fetchone()[0]
            cur.execute("""
                SELECT COUNT(DISTINCT guide_number)
                FROM simora_v2.fact_dispatch_log dl
                WHERE NOT EXISTS (
                    SELECT 1 FROM simora_v2.fact_courier_reports cr
                    WHERE cr.guide_number = dl.guide_number
                )
            """)
            unmatched_courier = cur.fetchone()[0]

        print(f"\nTotal en fact_dispatch_log : {total_in_db:,}")
        print(f"Guias con match courier    : {matched_courier:,}")
        print(f"Guias SIN match courier    : {unmatched_courier:,}  <- dispatched but no delivery report")

        # Bitacora
        try:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO audit.log_entries
                      (slug, category, severity, title, body, tags,
                       source, affected_count, status)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                """, [
                    "simora",
                    "etl",
                    "info",
                    "ETL 04: Planillas diarias Domiflash ingestadas en fact_dispatch_log",
                    (
                        f"Se procesaron {total_files:,} archivos diarios de Domiflash "
                        f"(Distribucion Local 2023-2026) con {total_records:,} registros. "
                        f"Tabla creada: simora_v2.fact_dispatch_log. "
                        f"Cruce con courier_reports: {matched_courier:,} guias con match, "
                        f"{unmatched_courier:,} sin match (despachadas pero sin reporte de entrega). "
                        f"Esta tabla es la fuente de verdad de lo que Simora entrego a Domiflash."
                    ),
                    ["etl", "dispatch", "domiflash", "fact_dispatch_log"],
                    "04_domiflash_daily_dispatch.py",
                    total_records,
                    "resolved",
                ])
            conn.commit()
            print("Bitacora actualizada.")
        except Exception as e:
            print(f"[!] Bitacora: {e}")

    conn.close()
    return {
        "files":   total_files,
        "records": total_records,
        "inserted": total_ins,
        "updated":  total_upd,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--year", type=int, help="Año específico (2023-2026). Sin arg = todos.")
    args = parser.parse_args()

    if args.year:
        years_to_run = [args.year]
    else:
        years_to_run = [2023, 2024, 2025, 2026]

    result = run(years_to_run, args.dry_run)
    print("\n" + json.dumps(result, indent=2, default=str))
