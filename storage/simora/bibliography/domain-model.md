# Domain Model — Simora

## Actores

```
┌───────────────┐      ┌──────────────────────┐      ┌───────────────┐
│   Cliente     │ ───► │  Simora (Magibell)   │ ───► │   Domiflash   │
│   final       │      │  — tenant Novalogic  │      │  (proveedor)  │
└───────────────┘      └──────┬───────┬───────┘      └───────┬───────┘
                              │       │                      │
                              ▼       ▼                      ▼
                      ┌──────────┐  ┌──────────┐      ┌─────────────┐
                      │Novalogic │  │ OneDrive │      │   Reportes  │
                      │   DB     │  │ (oficial)│      │  mensuales  │
                      │(ventas)  │  │          │      │   XLSX      │
                      └──────────┘  └──────────┘      └─────────────┘
```

## Flujos de valor principales

### 1. Venta → Envío → Cobro

1. Cliente compra en POS/ecommerce Magibell → **Novalogic DB** (`sales_orders`, `shipments`)
2. Simora entrega pedido a Domiflash (diario)
3. Domiflash intenta entrega (1ra, 2da, 3ra visita)
4. Domiflash emite reporte mensual (XLSX) a OneDrive Simora
5. Simora concilia reporte courier vs registros Novalogic

### 2. Movimientos financieros

1. Banco emite extracto mensual (XLSX o PDF) → OneDrive `Extractos Simora/YYYY/`
2. Contador externo lo usa para cierre mensual
3. Transferencias se registran en hoja `Registro de Transferencias` (568 MB en 2 XLSX — riesgo)

### 3. Conciliación mensual (objetivo del ETL)

```
OneDrive XLSX ─┐
               ├──► simora.courier_reports / bank_statements (raw_json + fila tipada)
Novalogic DB ──┤
               ├──► JOIN por tracking_code (MAG####) + fechas
Reglas envío ──┘
               └──► Reporte conciliación (bytes vs montos vs cobertura)
```

## Entidades canónicas (schema `simora`)

| Entidad | Propósito | Fuente original |
|---|---|---|
| `bank_accounts` | Cuentas bancarias del tenant | — (manual o derivado de extractos) |
| `bank_statements` | Extracto mensual por cuenta/periodo | OneDrive: Extractos Simora/YYYY/ |
| `bank_transactions` | Líneas del extracto | idem |
| `courier_reports` | Reporte mensual por courier/periodo | OneDrive: Reportes Local - Domiflash/YYYY/ |
| `courier_deliveries` | Líneas del reporte (entregas individuales) | idem |
| `daily_planillas` | Planillas diarias logística | OneDrive: Registro Planillas Diarias/ |
| `folder_mapping` | Reglas ETL: qué carpeta → qué tabla | tabla declarativa |
| `import_log` | Auditoría de ingestas | autogenerado |

## Relaciones con Novalogic API

| Entidad Simora (MCP DB) | Entidad Novalogic (API DB) | Cruce |
|---|---|---|
| `courier_deliveries.tracking_code` (`MAG####`) | `shipments.tracking_code` o `sales_orders.invoice_number` | match exacto |
| `bank_transactions.reference` | `payments.reference` | match libre |

El MCP no tiene acceso directo a Novalogic DB; se cruza vía Internal API con scopes `shipments:read`, `sales:read`.

## Riesgos conocidos del modelo

- **Domiflash no es tenant Novalogic**: conciliación es bilateral (OneDrive ↔ Novalogic Simora).
- **Extractos bancarios 2023/2024 en PDF**: requieren OCR — no ingestables directo.
- **`Registro de Transferencias` = 568 MB en 2 XLSX**: archivo frágil, debería fragmentarse.
- **Gaps en extractos**: 2023 solo fin de trimestre, 2024 bimestral, 2025 AGO-DIC faltan.
