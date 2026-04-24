# Data Lineage — Simora

Trazabilidad completa: OneDrive → ETL → MCP DB → Reports.

## Capas

```
┌────────────────────────────────────────────────────────────────────┐
│ 1. ORIGEN (OneDrive info@simora.co)                                │
│    Archivos XLSX/PDF en CONTROL INTERNO/Área_*/                    │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ Microsoft Graph API (device code flow)
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│ 2. SNAPSHOT (MCP DB: graph_nodes / graph_edges)                    │
│    4,914 archivos + 839 folders mapeados como árbol                │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ tenant_simora_ingest_mapping (ETL)
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│ 3. ESTRUCTURADO (MCP DB: schema simora)                            │
│    folder_mapping declara qué carpeta → qué tabla                  │
│    6 bank_statements + 3,432 bank_transactions                     │
│    37 courier_reports + 39,616 courier_deliveries                  │
└──────────────────────┬─────────────────────────────────────────────┘
                       │ tenant_simora_query + tenant_ms_download_to_dataset
                       ▼
┌────────────────────────────────────────────────────────────────────┐
│ 4. DERIVADO                                                        │
│    datasets/ (archivos originales mirror)                          │
│    reports/audit/ (markdown generados por flows)                   │
└────────────────────────────────────────────────────────────────────┘
```

## Tabla de lineage completa

| Dato | Origen OneDrive (handle) | Parser | Tabla destino | Tool |
|---|---|---|---|---|
| Reportes courier Domiflash 2023 (9 XLSX) | `logistics.courier_reportes_domiflash/2023` | `xlsx-courier-monthly` | `simora.courier_reports` + `...deliveries` | `tenant_simora_ingest_mapping id=7` |
| Reportes courier Domiflash 2024 (12 XLSX) | `.../2024` | idem | idem | `id=6` |
| Reportes courier Domiflash 2025 (12 XLSX) | `.../2025` | idem | idem | `id=4` |
| Reportes courier Domiflash 2026 (4 XLSX) | `.../2026` | idem | idem | `id=5` |
| Extractos banco 2025 (7 XLSX) | `accounting.extractos_2025` | `xlsx-bank-monthly` | `simora.bank_statements` + `...transactions` | `id=1` |
| Extractos banco 2023 (4 PDF) | `accounting.extractos_2023` | `pdf-bank` (TODO) | `simora.bank_statements` | `id=2` — bloqueado |
| Extractos banco 2024 (4 PDF) | `accounting.extractos_2024` | `pdf-bank` (TODO) | `simora.bank_statements` | `id=3` — bloqueado |
| Planillas diarias (23+ XLSX) | `logistics.registro_planillas_diarias` | no mapeado aún | `simora.daily_planillas` | TBD |

## Cómo declarar un lineage nuevo

1. Identificar folder en OneDrive → obtener `item_id` (vía `graph_nodes_list` o `tenant_ms_graph_request`).
2. Anclar como handle en `integrations/microsoft.json` (opcional pero recomendado).
3. Insertar en `simora.folder_mapping` con: `onedrive_key`, `business_entity`, `target_table`, `parser`, `period_pattern` (regex con named groups `year`, `month`), `metadata` (contexto).
4. Si el parser no existe: agregarlo en `tenant_simora_ingest_mapping` (tools.ts).
5. Documentar aquí en la tabla de lineage.

## Trazabilidad por fila

Toda fila en `simora.*` lleva:
- `source_item_id` — OneDrive item id original
- `source_file_name` — nombre del archivo
- `source_web_url` — link directo a SharePoint
- `imported_at` — timestamp de la ingesta
- `raw_row` / `raw_json` — payload completo para replay

La tabla `simora.import_log` registra cada operación (`ingest` ok/error con `error_message`).

## Re-ingesta

Las tablas `simora.bank_statements` y `simora.courier_reports` tienen UNIQUE constraint en `(account_id/courier, period_year, period_month)` con `ON CONFLICT DO UPDATE` — seguras para re-ejecutar sin duplicar.

Las líneas (`..._transactions`, `..._deliveries`) se borran y re-insertan por statement/report.
