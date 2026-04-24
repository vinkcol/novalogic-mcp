import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "utils"))
import simora_db

conn = simora_db.get_conn()
cur = conn.cursor()

cur.execute("""
SELECT
  COUNT(*) total,
  ROUND(COUNT(*) FILTER (WHERE city IS NOT NULL AND city != '') * 100.0 / COUNT(*), 1) city_pct,
  ROUND(COUNT(*) FILTER (WHERE locality IS NOT NULL) * 100.0 / COUNT(*), 1) locality_pct,
  ROUND(COUNT(*) FILTER (WHERE neighborhood IS NOT NULL) * 100.0 / COUNT(*), 1) neigh_pct,
  ROUND(COUNT(*) FILTER (WHERE address IS NOT NULL) * 100.0 / COUNT(*), 1) addr_pct,
  ROUND(COUNT(*) FILTER (WHERE dim_employee_id IS NOT NULL) * 100.0 / COUNT(*), 1) emp_pct,
  ROUND(COUNT(*) FILTER (WHERE customer_id IS NOT NULL) * 100.0 / COUNT(*), 1) cust_pct,
  ROUND(COUNT(*) FILTER (WHERE carrier_resolved IS NOT NULL) * 100.0 / COUNT(*), 1) carrier_pct
FROM simora_v2.fact_orders
""")
r = cur.fetchone()
print('=== fact_orders cobertura ===')
print(f'  city              : {r[1]}%')
print(f'  locality          : {r[2]}%  (solo Bogotá)')
print(f'  neighborhood      : {r[3]}%')
print(f'  address           : {r[4]}%')
print(f'  dim_employee_id   : {r[5]}%')
print(f'  customer_id       : {r[6]}%')
print(f'  carrier_resolved  : {r[7]}%')

cur.execute("""
SELECT
  COUNT(*) total,
  ROUND(COUNT(*) FILTER (WHERE product_id IS NOT NULL) * 100.0 / COUNT(*), 1) pid_pct,
  ROUND(COUNT(*) FILTER (WHERE product_name IS NOT NULL AND product_name != '') * 100.0 / COUNT(*), 1) name_pct,
  ROUND(COUNT(*) FILTER (WHERE unit_price > 0) * 100.0 / COUNT(*), 1) price_pct
FROM simora_v2.fact_order_items
""")
r = cur.fetchone()
print()
print('=== fact_order_items cobertura ===')
print(f'  product_id        : {r[1]}%')
print(f'  product_name      : {r[2]}%')
print(f'  unit_price > 0    : {r[3]}%')

cur.execute("""
SELECT
  COUNT(*) total,
  ROUND(COUNT(*) FILTER (WHERE city IS NOT NULL AND city != '') * 100.0 / COUNT(*), 1) city_pct,
  ROUND(COUNT(*) FILTER (WHERE address IS NOT NULL) * 100.0 / COUNT(*), 1) addr_pct,
  ROUND(COUNT(*) FILTER (WHERE locality IS NOT NULL) * 100.0 / COUNT(*), 1) loc_pct,
  ROUND(COUNT(*) FILTER (WHERE neighborhood IS NOT NULL) * 100.0 / COUNT(*), 1) neigh_pct,
  ROUND(COUNT(*) FILTER (WHERE phone IS NOT NULL) * 100.0 / COUNT(*), 1) phone_pct
FROM simora_v2.dim_customers
""")
r = cur.fetchone()
print()
print('=== dim_customers cobertura ===')
print(f'  city              : {r[1]}%')
print(f'  address           : {r[2]}%')
print(f'  locality          : {r[3]}%  (solo Bogotá)')
print(f'  neighborhood      : {r[4]}%')
print(f'  phone             : {r[5]}%')

cur.execute("""
SELECT
  COUNT(*) total,
  ROUND(COUNT(*) FILTER (WHERE unit_price > 0) * 100.0 / COUNT(*), 1) price_pct,
  COUNT(*) FILTER (WHERE unit_price IS NULL OR unit_price = 0) sin_precio,
  COUNT(*) FILTER (WHERE categoria = 'obsequio') obsequios
FROM simora_v2.dim_products
""")
r = cur.fetchone()
print()
print('=== dim_products cobertura ===')
print(f'  unit_price > 0    : {r[1]}%')
print(f'  sin precio        : {r[2]}  ({r[3]} son obsequios con precio $0 correcto)')

cur.execute("""
SELECT
  COALESCE(SUM(total), 0) AS revenue_total,
  COALESCE(SUM(total) FILTER (WHERE delivery_status = 'delivered'), 0) AS rev_entregado,
  COALESCE(SUM(total) FILTER (WHERE delivery_status = 'unconfirmed'), 0) AS rev_unconfirmed,
  COALESCE(SUM(total) FILTER (WHERE delivery_status = 'returned'), 0) AS rev_devuelto,
  COUNT(DISTINCT customer_id) AS clientes_activos,
  COUNT(DISTINCT dim_employee_id) AS vendedores,
  MIN(order_date)::date AS primera_orden,
  MAX(order_date)::date AS ultima_orden
FROM simora_v2.fact_orders
""")
r = cur.fetchone()
print()
print('=== KPIs generales ===')
print(f'  Revenue total     : ${int(r[0]):>15,}')
print(f'  Revenue entregado : ${int(r[1]):>15,}  ({round(r[1]/r[0]*100,1)}%)')
print(f'  Revenue unconfirmd: ${int(r[2]):>15,}  ({round(r[2]/r[0]*100,1)}%)')
print(f'  Revenue devuelto  : ${int(r[3]):>15,}  ({round(r[3]/r[0]*100,1)}%)')
print(f'  Clientes activos  : {r[4]:>8,}')
print(f'  Vendedores        : {r[5]:>8,}')
print(f'  Rango de fechas   : {r[6]} → {r[7]}')

# Fixes aplicados
cur.execute("""
SELECT slug, title, affected_count, created_at::date
FROM audit.log_entries
WHERE category = 'data_quality'
ORDER BY created_at
""")
rows = cur.fetchall()
print()
print(f'=== Fixes aplicados ({len(rows)}) ===')
for r in rows:
    print(f'  {str(r[3])}  {str(r[1])[:65]:<65}  ({int(r[2] or 0):,} filas)')

conn.close()
