# Session Checkpoint — 2026-04-17

Estado actual del workspace Simora / simora_v2 para retomar rápidamente.

---

## Recovery rápido

1. Leer este archivo + `README.md` + `bibliography/`.
2. Verificar conexión Microsoft: `tenant_ms_auth_status({slug:"simora"})`.
3. Verificar DB: `docker exec -it novalogic-mcp-db psql -U novalogic -d novalogic_mcp -c "SELECT schemaname, tablename, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', schemaname, tablename), false, true, '')))[1]::text::int AS rows FROM pg_tables WHERE schemaname = 'simora_v2' ORDER BY tablename;"`

---

## Estado del ETL (simora_v2)

| ETL | Script | Estado | Registros |
|-----|--------|--------|-----------|
| 01 — Legacy MongoDB → simora_v2 | `scripts/etl/01_legacy_mongo_to_simora_v2.py` | ✅ COMPLETO | 8 sellers, 19,133 clientes, 154 productos, 22,360 órdenes, 25,734 items, 22,360 guías |
| 02 — Novalogic ERP → simora_v2 | `scripts/etl/02_novalogic_to_simora_v2.py` | ✅ COMPLETO | Guías, sellers, clientes, productos Novalogic (dic 2025 →) |
| 03 — OneDrive XLSX → simora_v2 | `scripts/etl/03_onedrive_to_simora_v2.py` | ✅ COMPLETO | 37,540 filas courier + 198 transacciones bancarias |

**Arquitectura ETL**: Todos los scripts escriben directamente a `novalogic_mcp` (port 5433) vía `simora_db.py`.  
No usan la Internal API de Novalogic. Lectura ERP usa `novalogic_erp_n` (port 5436) solo-lectura.

---

## Hallazgos clave — sesión 2026-04-17

### 1. Corrección de números de guía (courier)

**Problema**: Mismos envíos aparecían con distinto zero-padding en distintos archivos XLSX mensuales.  
- Sistema Novalogic: `MAG000117`  
- Courier Domiflash: `MAG00117` o `MAG0117`  
- Además: guías repetidas en múltiples archivos mensuales (actualización de estado)

**Solución**: `scripts/fixes/fix_guide_numbers.py`
- Construye `sistema_by_num: dict[int, str]` — formato canónico indexado por valor numérico
- Para cada grupo de variantes: el más reciente (y que ya tiene formato canónico) queda sin sufijo
- Los duplicados históricos se marcan: `MAG000117-1`, `MAG000117-2`, etc.
- Orden de aplicación: sufijos primero (liberan constraint), luego zero-padding fixes
- **Resultado**: 934 sufijos `-N` + 226 zero-padding fixes aplicados

**Filtro de calidad en queries**: `AND guide_number !~ '-[0-9]+$'` para excluir históricos.

### 2. Falsos positivos en reconciliación (guide recycling)

**Problema**: Novalogic reutilizó los números `MAG50001–MAG50052` al arrancar en diciembre 2025.  
Los mismos números ya existían en el sistema legacy (noviembre 2024).  
El archivo `2025-12.xlsx` del courier coincidía con las guías legacy de 2024 → 381 falsos positivos.

**Detección**: `scripts/fixes/check_false_positives.py`  
- Identificó 380 guías con `diff_dias > 90` (hasta 376 días de diferencia)
- 6 negativos extremos (hasta -804 días)

**Solución en reconciliación**: ventana de fecha en el JOIN:
```sql
cr.report_date BETWEEN fg.ship_date::date - INTERVAL '90 days'
                   AND fg.ship_date::date + INTERVAL '180 days'
```

### 3. Métricas de reconciliación (estado actual)

| Métrica | Valor |
|---------|-------|
| Guías en sistema (MAG) | ~25,126 |
| Guías en courier (MAG, sin `-N`) | ~25,362 |
| Matched con ventana de fecha | ~14,753 (58.7%) |
| Solo en sistema (sin reporte courier) | ~10,373 |
| Solo en courier (sin match sistema) | ~10,609 |
| Falsos positivos detectados | 381 |

**Script de análisis**: `scripts/analysis/01_guide_reconciliation.py`  
Ejecutar: `python 01_guide_reconciliation.py --format table`

---

## Tareas pendientes (priorizado)

| # | Tarea | Prioridad | Notas |
|---|-------|-----------|-------|
| 1 | **ETL dim_employees**: cruzar legacy MongoDB con Novalogic ERP, backfill `fact_guides.dim_employee_id` y `fact_orders.dim_employee_id` | Alta | Script no escrito aún |
| 2 | **Normalización de ciudades** en `fact_courier_reports.destination`: `Bogotá` vs `BOGOTÁ` (~20,792 filas) | Media | Requiere tabla de equivalencias |
| 3 | **Correr agente de anomalías contables** (`02_accounting_anomaly_agent.py`) | Media | DSN ya apunta a `novalogic_mcp` pero no se ha ejecutado en esta sesión |
| 4 | **Limpiar migraciones NestJS** que crearon `simora_v2` en `novalogic_erp_n` | Media | `1776400000000` y `1776500000000` — revertir con `migration:revert` |
| 5 | **Resolver 381 falsos positivos** a nivel de datos: marcar guías legacy `MAG50001-MAG50052` como recicladas o sufijos `-legacy` | Baja-Media | Decisión de diseño pendiente |
| 6 | **Parsear PDFs bancarios** 2023/2024 (8 archivos) | Baja | Requiere `pdf-bank` parser |
| 7 | **Ingestar daily_planillas** (21+ XLSX enero 2026) | Baja | Tabla `simora_v2.daily_planillas` por crear |

---

## Arquitectura de datos

### Bases de datos

| Instancia Docker | Puerto | DB | Uso |
|-----------------|--------|----|-----|
| `novalogic-mcp-db` | 5433 | `novalogic_mcp` | **ESCRITURA simora_v2** |
| `novalogic-postgres-n` | 5436 | `novalogic_erp_n` | Lectura ERP Novalogic |
| MongoDB | — | `erp_legacy` | Lectura legacy (simora_db.mongo_conn) |

### Schema simora_v2 (tablas principales)

```
dim_sellers           — vendedores (legacy + Novalogic)
dim_employees         — empleados (cross-referencia en construcción)
dim_customers         — clientes
dim_products          — productos
fact_orders           — órdenes / ventas
fact_order_items      — líneas de orden
fact_guides           — guías de envío
fact_courier_reports  — reportes mensuales courier (Domiflash XLSX)
fact_bank_transactions — transacciones bancarias (Occidente XLSX/PDF)
etl_runs              — log de ejecuciones ETL
```

### Utilidades

```
scripts/utils/simora_db.py   — conexión + upsert functions para todos los scripts
scripts/fixes/                — correcciones puntuales de datos
scripts/analysis/             — scripts de análisis y conciliación
scripts/etl/                  — carga de datos
```

---

## Herramientas de diagnóstico

```bash
# Acceso DB directo
docker exec -it novalogic-mcp-db psql -U novalogic -d novalogic_mcp

# Contar guías con/sin sufijo
SELECT count(*) FILTER (WHERE guide_number !~ '-[0-9]+$') AS canonicas,
       count(*) FILTER (WHERE guide_number ~ '-[0-9]+$')  AS historicas
FROM simora_v2.fact_courier_reports WHERE guide_number LIKE 'MAG%';

# Verificar ETLs
SELECT run_id, script, status, started_at, finished_at,
       inserts, updates, errors
FROM simora_v2.etl_runs ORDER BY started_at DESC LIMIT 10;
```

---

## Contactos / credenciales

- Cuenta Microsoft conectada: `info@simora.co` (Simora SAS BIC)
- Token storage: `storage/simora/integrations/.microsoft.tokens.enc`
- Encryption key: `MCP_TOKEN_ENCRYPTION_KEY` en `novalogic-mcp/.env`
- CompanyId Novalogic Simora: `2af87e54-33a6-4a60-9b88-63582d3edacb`
- Python ETL: usar `python` (3.11), no `python3`
