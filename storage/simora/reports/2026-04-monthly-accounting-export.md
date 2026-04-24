# Export Contable — Abril 2026
**Tenant:** Simora (Magibell)
**Período:** 2026-04-01 → 2026-04-30
**Generado:** 2026-04-18
**Fuente:** Novalogic (accounting_ops_summary + delivery_activity)

---

## 1. Movimientos Contables Reconocidos (base caja — entregados)

| Fecha | Concepto | Cuenta | Débito | Crédito |
|-------|----------|--------|-------:|--------:|
| 2026-04-18 | Ventas Domiflash — 37 entregas confirmadas (subtotal sin flete) | 4135-01 | | $1,677,000 |
| 2026-04-18 | Cobro por envío — 37 entregas | 4135-03 | | $58,500 |
| 2026-04-18 | Costo envío Domiflash — 37 guías entregadas | 5295-01 | $251,500 | |
| | **TOTAL** | | **$251,500** | **$1,735,500** |
| | **BALANCE NETO** | | | **$1,484,000** |

> Nota: Las fechas contables corresponden al día de entrega efectiva registrada en Novalogic (2026-04-18 — lote conciliado en sesión anterior).

---

## 2. Actividad Operativa Completa de Abril (comprometido)

| Indicador | Valor |
|-----------|------:|
| Días con actividad | 14 |
| Total órdenes despachadas | 259 |
| Entregadas (reconocidas) | 37 |
| Pendientes de entrega | 222 |
| Revenue total comprometido | $12,807,500 |
| Revenue reconocido (entregados) | $1,735,500 |
| **Pendiente de recaudo** | **$11,072,000** |
| Flete cobrado al cliente (entregados) | $58,500 |
| Costo flete real (entregados) | $251,500 |
| Margen flete (entregados) | -$193,000 |
| Costo flete acumulado (259 órdenes) | $1,906,500 |
| Flete cobrado acumulado (259 órdenes) | $522,000 |
| **Margen flete acumulado** | **-$1,384,500** |

---

## 3. Días con Actividad — Detalle

| Fecha | Órdenes | Entregadas | Revenue | Flete cobrado | Costo flete | Margen flete |
|-------|--------:|-----------:|--------:|--------------:|------------:|-------------:|
| 2026-04-04 | 4 | 0 | $174,000 | $13,500 | $34,500 | -$21,000 |
| 2026-04-06 | 18 | 0 | $1,216,500 | $91,500 | $136,500 | -$45,000 |
| 2026-04-07 | 25 | 0 | $1,320,000 | $31,000 | $179,500 | -$148,500 |
| 2026-04-08 | 7 | 0 | $342,500 | $15,000 | $54,000 | -$39,000 |
| 2026-04-09 | 22 | 0 | $1,098,500 | $59,500 | $173,500 | -$114,000 |
| 2026-04-10 | 25 | 0 | $1,224,000 | $49,500 | $190,500 | -$141,000 |
| 2026-04-11 | 19 | 0 | $841,500 | $0 | $123,500 | -$123,500 |
| 2026-04-13 | 24 | 0 | $1,193,500 | $82,000 | $195,000 | -$113,000 |
| 2026-04-14 | 8 | 0 | $599,500 | $28,000 | $60,500 | -$32,500 |
| 2026-04-15 | 24 | 0 | $1,205,500 | $39,000 | $178,000 | -$139,000 |
| 2026-04-16 | 27 | 0 | $1,102,000 | $41,500 | $195,000 | -$153,500 |
| 2026-04-17 | 18 | 0 | $726,000 | $13,000 | $128,000 | -$115,000 |
| 2026-04-18 | 37 | 37 | $1,735,500 | $58,500 | $251,500 | -$193,000 |
| 2026-04-20 | 1 | 0 | $28,500 | $0 | $6,500 | -$6,500 |
| **TOTAL** | **259** | **37** | **$12,807,500** | **$522,000** | **$1,906,500** | **-$1,384,500** |

---

## 4. Hallazgos y Alertas

| Código | Severidad | Descripción |
|--------|-----------|-------------|
| ALERT-01 | 🔴 Alta | 222 órdenes (86%) aún pendientes de entrega — $11,072,000 en recaudo no reconocido |
| ALERT-02 | 🔴 Alta | Margen flete negativo acumulado: -$1,384,500 (flete cobrado cubre solo 27% del costo real) |
| ALERT-03 | 🟡 Media | Abril 1 ausente del sistema: 16 envíos despachados sin registro en Novalogic (MAG000291–306) |
| ALERT-04 | 🟡 Media | MAG000294/304 (VTA-0323/0328): despachados sin Shipment creado en Novalogic (hallazgo #48) |
| ALERT-05 | 🟡 Media | 4 órdenes del 4-abr siguen `in_preparation`: VTA-0347 (Servientrega), VTA-0350/0352/0356 (Domiflash) |
| ALERT-06 | ℹ️ Info | Plan de cuentas: sin movimientos en 4175-01 (devoluciones) — 0 devoluciones reconocidas en abril |

---

## 5. Plan de Cuentas Utilizado

| Cuenta | Código | Saldo Abril |
|--------|--------|------------:|
| Ventas POS | 4135-01 | +$1,677,000 |
| Ventas Ecommerce | 4135-02 | $0 |
| Cobro por envío | 4135-03 | +$58,500 |
| Costo envío pagado | 5295-01 | -$251,500 |
| Costo inventario | 6135-01 | $0 (sin datos) |
| Descuentos promocionales | 5395-01 | $0 |
| Devoluciones | 4175-01 | $0 |

---

*Generado automáticamente por Simora MCP · workflow: monthly-accounting-export v1.0*
*Fuentes: accounting_ops_summary, accounting_ops_delivery_activity, tenant_mapping chart-of-accounts*
