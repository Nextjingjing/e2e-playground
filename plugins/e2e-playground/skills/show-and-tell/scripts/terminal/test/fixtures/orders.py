"""Tiny demo CLI for paintext tests: a [y/N] prompt, Thai output, a \\r progress bar, SQLite.

usage: python orders.py --db orders.db add <code> <name>
       python orders.py --db orders.db list
"""
import argparse, sqlite3, sys, time

sys.stdout.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--db", required=True)
    sub = ap.add_subparsers(dest="cmd", required=True)
    add = sub.add_parser("add"); add.add_argument("code"); add.add_argument("name")
    sub.add_parser("list")
    a = ap.parse_args()
    db = sqlite3.connect(a.db)
    db.execute("create table if not exists orders (code text primary key, name text)")
    if a.cmd == "add":
        print(f"จะบันทึก {a.code} {a.name}")
        if input("Continue? [y/N] ").strip().lower() != "y":
            print("ยกเลิก")
            sys.exit(1)
        for i in range(1, 6):
            bar = "#" * (i * 2)
            print(f"\r[{bar:<10}] {i * 20}%", end="", flush=True)
            time.sleep(0.3)
        print()
        db.execute("insert or replace into orders values (?, ?)", (a.code, a.name))
        db.commit()
        print("บันทึกแล้ว ✔")
    else:
        print("code    name")
        for code, name in db.execute("select code, name from orders order by code"):
            print(f"{code:<8}{name}")


main()
