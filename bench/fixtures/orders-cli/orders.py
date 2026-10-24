"""Import orders from CSV into SQLite. usage: orders.py import <csv> | list"""
import csv, sqlite3, sys

sys.stdout.reconfigure(encoding="utf-8")
db = sqlite3.connect("orders.db")
db.execute("create table if not exists orders (code text primary key, product text, qty int)")

def main():
    if sys.argv[1] == "import":
        rows = list(csv.DictReader(open(sys.argv[2], encoding="utf-8")))
        for r in rows:
            print(f"{r['code']:<8}{r['product']:<12}{r['qty']}")
        if input(f"Import {len(rows)} orders? [y/N] ").strip().lower() != "y":
            print("cancelled"); return 1
        db.executemany("insert or replace into orders values (:code, :product, :qty)", rows); db.commit()
        print(f"imported {len(rows)} orders")
    else:
        for row in db.execute("select * from orders order by code"):
            print(*row)

sys.exit(main())
