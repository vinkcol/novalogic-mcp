import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "utils"))
import simora_db

conn = simora_db.get_conn()
with conn.cursor() as cur:
    cur.execute("""
        SELECT
            fg.guide_number,
            fg.source          AS fuente_sistema,
            fg.ship_date::date,
            cr.report_date,
            (cr.report_date - fg.ship_date::date) AS diff_dias,
            cr.source_file,
            cr.status          AS estado_courier
        FROM simora_v2.fact_guides fg
        JOIN simora_v2.fact_courier_reports cr USING (guide_number)
        WHERE fg.guide_number LIKE 'MAG%%'
          AND cr.guide_number !~ '-[0-9]+$'
          AND fg.ship_date IS NOT NULL
          AND (cr.report_date - fg.ship_date::date) > 90
        ORDER BY diff_dias DESC
        LIMIT 25
    """)
    print("guide_number     fuente         ship_date   report_date  diff   source_file         estado")
    print("-" * 105)
    for r in cur.fetchall():
        print(f"  {str(r[0]):15s}  {str(r[1]):13s}  {str(r[2])[:10]}  {str(r[3])[:10]}  {int(r[4]):>5}d  {str(r[5]):20s}  {r[6]}")

    print()
    cur.execute("""
        SELECT fg.source, COUNT(*) AS cnt
        FROM simora_v2.fact_guides fg
        JOIN simora_v2.fact_courier_reports cr USING (guide_number)
        WHERE fg.guide_number LIKE 'MAG%%'
          AND cr.guide_number !~ '-[0-9]+$'
          AND fg.ship_date IS NOT NULL
          AND (cr.report_date - fg.ship_date::date) > 90
        GROUP BY fg.source
        ORDER BY cnt DESC
    """)
    print("Por fuente:")
    for r in cur.fetchall():
        print(f"  {r[0]}: {int(r[1])}")

    # Tambien verificar los negativos extremos (< -30d)
    print()
    cur.execute("""
        SELECT
            fg.guide_number,
            fg.source,
            fg.ship_date::date,
            cr.report_date,
            (cr.report_date - fg.ship_date::date) AS diff_dias,
            cr.source_file
        FROM simora_v2.fact_guides fg
        JOIN simora_v2.fact_courier_reports cr USING (guide_number)
        WHERE fg.guide_number LIKE 'MAG%%'
          AND cr.guide_number !~ '-[0-9]+$'
          AND fg.ship_date IS NOT NULL
          AND (cr.report_date - fg.ship_date::date) < -30
        ORDER BY diff_dias ASC
    """)
    rows = cur.fetchall()
    print(f"Negativos extremos (< -30d): {len(rows)}")
    for r in rows:
        print(f"  {str(r[0]):15s}  {str(r[1]):13s}  {str(r[2])[:10]}  {str(r[3])[:10]}  {int(r[4]):>5}d  {r[5]}")

conn.close()
