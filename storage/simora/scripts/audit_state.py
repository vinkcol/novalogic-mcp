import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent / "utils"))
import simora_db

conn = simora_db.get_conn()
cur = conn.cursor()

# fact_orders
cur.execute("""
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE delivery_status IS NULL OR delivery_status = 'unknown') AS sin_status,
  COUNT(*) FILTER (WHERE carrier_resolved IS NULL) AS sin_carrier,
  COUNT(*) FILTER (WHERE city IS NULL OR city = '') AS sin_ciudad,
  COUNT(*) FILTER (WHERE customer_id IS NULL) AS sin_cliente,
  COUNT(*) FILTER (WHERE dim_employee_id IS NULL) AS sin_vendedor,
  COUNT(*) FILTER (WHERE seller_id IS NULL) AS sin_seller_id
FROM simora_v2.fact_orders
""")
r = cur.fetchone()
print('=== fact_orders ===')
print(f'  total              : {r[0]:>8,}')
print(f'  sin delivery_status: {r[1]:>8,}')
print(f'  sin carrier        : {r[2]:>8,}')
print(f'  sin ciudad         : {r[3]:>8,}')
print(f'  sin customer_id    : {r[4]:>8,}')
print(f'  sin dim_employee_id: {r[5]:>8,}')
print(f'  sin seller_id      : {r[6]:>8,}')

cur.execute("""
SELECT delivery_status, COUNT(*) n, COALESCE(SUM(total),0) revenue
FROM simora_v2.fact_orders
GROUP BY delivery_status ORDER BY revenue DESC
""")
print('\n  delivery_status:')
for r in cur.fetchall():
    print(f'    {str(r[0]):<22} {int(r[1]):>6,}  ${int(r[2]):>15,}')

cur.execute("""
SELECT carrier_resolved, carrier_confidence, COUNT(*) n, COALESCE(SUM(total),0) revenue
FROM simora_v2.fact_orders
GROUP BY carrier_resolved, carrier_confidence ORDER BY revenue DESC
""")
print('\n  carrier_resolved:')
for r in cur.fetchall():
    print(f'    {str(r[0]):<22} {str(r[1]):<8} {int(r[2]):>6,}  ${int(r[3]):>15,}')

# fact_order_items
cur.execute("""
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE product_id IS NULL) AS sin_product,
  COUNT(*) FILTER (WHERE unit_price IS NULL OR unit_price = 0) AS precio_cero,
  COALESCE(SUM(total),0) AS revenue_total,
  COALESCE(SUM(total) FILTER (WHERE product_id IS NULL),0) AS revenue_orphan
FROM simora_v2.fact_order_items
""")
r = cur.fetchone()
print('\n=== fact_order_items ===')
print(f'  total              : {r[0]:>8,}')
print(f'  sin product_id     : {r[1]:>8,}')
print(f'  precio cero/null   : {r[2]:>8,}')
print(f'  revenue total      : ${int(r[3]):>15,}')
print(f'  revenue huerfano   : ${int(r[4]):>15,}')

# dim_products
cur.execute("""
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE marca IS NULL) AS sin_marca,
  COUNT(*) FILTER (WHERE categoria IS NULL) AS sin_cat,
  COUNT(*) FILTER (WHERE canal_venta IS NULL) AS sin_canal,
  COUNT(*) FILTER (WHERE unit_price IS NULL OR unit_price = 0) AS sin_precio,
  COUNT(*) FILTER (WHERE canonical_id IS NULL AND product_type = 'variant_instance') AS vi_sin_can,
  COUNT(*) FILTER (WHERE product_type IS NULL) AS sin_type
FROM simora_v2.dim_products
""")
r = cur.fetchone()
print('\n=== dim_products ===')
print(f'  total              : {r[0]:>8,}')
print(f'  sin marca          : {r[1]:>8,}')
print(f'  sin categoria      : {r[2]:>8,}')
print(f'  sin canal_venta    : {r[3]:>8,}')
print(f'  sin unit_price     : {r[4]:>8,}')
print(f'  variant_inst s/can : {r[5]:>8,}')
print(f'  sin product_type   : {r[6]:>8,}')

# dim_customers
cur.execute("""
SELECT
  COUNT(*) AS total,
  COUNT(*) FILTER (WHERE phone IS NULL OR phone = '') AS sin_phone,
  COUNT(*) FILTER (WHERE city IS NULL OR city = '') AS sin_ciudad,
  COUNT(*) FILTER (WHERE full_name IS NULL OR full_name = '') AS sin_nombre
FROM simora_v2.dim_customers
""")
r = cur.fetchone()
print('\n=== dim_customers ===')
print(f'  total              : {r[0]:>8,}')
print(f'  sin phone          : {r[1]:>8,}')
print(f'  sin ciudad         : {r[2]:>8,}')
print(f'  sin nombre         : {r[3]:>8,}')

# tablas
cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'simora_v2' ORDER BY tablename")
tables = [r[0] for r in cur.fetchall()]
print('\n=== Tablas simora_v2 ===')
for t in tables:
    cur.execute(f'SELECT COUNT(*) FROM simora_v2.{t}')
    n = cur.fetchone()[0]
    print(f'  {t:<35} {n:>8,}')

conn.close()
