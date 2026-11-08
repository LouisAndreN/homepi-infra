#!/usr/bin/env python3
"""Migration 001: store every timestamp as UTC ISO 8601 with Z.

Until 2026-10-25 the API wrote datetime('now','utc'). SQLite's 'utc' modifier treats its input as local
time, but 'now' is already UTC: on the Pi (Asia/Tokyo, no daylight saving) every stored time is 9 hours
early (proven on 2026-11-08 against the nginx access log, to the second).

The migration, in one transaction:
1. shifts every old-format value ('YYYY-MM-DD HH:MM:SS') of the columns below by +9 hours and rewrites it
   as '%Y-%m-%dT%H:%M:%SZ';
2. rebuilds every table whose column defaults still use datetime('now','utc'), with the correct default,
   keeping rows, indexes and triggers;
3. sets PRAGMA user_version to 1. A second run does nothing.

Usage: 001_utc_timestamps.py DATABASE
"""
import re
import sqlite3
import sys

TARGET_VERSION = 1
SHIFT = "+9 hours"
COLUMNS = [
    ("devices", "last_seen"),
    ("devices", "enrolled_at"),
    ("audit_log", "ts"),
    ("firmware_catalog", "uploaded_at"),
    ("ota_deployments", "created_at"),
    ("ota_deployment_devices", "sent_at"),
    ("ota_deployment_devices", "confirmed_at"),
    ("unknown_capability_sets", "first_seen"),
]
OLD_FORMAT = "[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9] [0-9][0-9]:[0-9][0-9]:[0-9][0-9]*"
OLD_DEFAULT = re.compile(r"datetime\(\s*'now'\s*,\s*'utc'\s*\)", re.IGNORECASE)
NEW_DEFAULT = "strftime('%Y-%m-%dT%H:%M:%SZ','now')"


def table_columns(conn, table):
    return [row[1] for row in conn.execute(f'PRAGMA table_info("{table}")')]


def migrate(path):
    conn = sqlite3.connect(path, isolation_level=None)
    version = conn.execute("PRAGMA user_version").fetchone()[0]
    if version >= TARGET_VERSION:
        print(f"already migrated (user_version {version})")
        return 0
    conn.execute("PRAGMA foreign_keys=OFF")
    conn.execute("PRAGMA legacy_alter_table=ON")
    conn.execute("BEGIN IMMEDIATE")
    try:
        shifted = []
        for table, column in COLUMNS:
            if column not in table_columns(conn, table):
                continue
            count = conn.execute(
                f'UPDATE "{table}" SET "{column}" = strftime(\'%Y-%m-%dT%H:%M:%SZ\', "{column}", ?) '
                f'WHERE "{column}" GLOB ?', (SHIFT, OLD_FORMAT)).rowcount
            shifted.append(f"{table}.{column} {count}")
        rebuilt = []
        tables = conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL").fetchall()
        for name, sql in tables:
            if name.startswith("sqlite_") or not OLD_DEFAULT.search(sql):
                continue
            extras = [row[0] for row in conn.execute(
                "SELECT sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') "
                "AND sql IS NOT NULL", (name,))]
            temp = f"{name}__migration_001"
            new_sql = OLD_DEFAULT.sub(NEW_DEFAULT, sql)
            new_sql, renamed = re.subn(
                r'^\s*CREATE\s+TABLE\s+(IF\s+NOT\s+EXISTS\s+)?(["`\[]?)' + re.escape(name) + r'(["`\]]?)',
                f'CREATE TABLE "{temp}"', new_sql, count=1, flags=re.IGNORECASE)
            if renamed != 1:
                raise RuntimeError(f"cannot rewrite the CREATE statement of {name}")
            columns = ", ".join(f'"{c}"' for c in table_columns(conn, name))
            before = conn.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
            conn.execute(new_sql)
            conn.execute(f'INSERT INTO "{temp}" ({columns}) SELECT {columns} FROM "{name}"')
            conn.execute(f'DROP TABLE "{name}"')
            conn.execute(f'ALTER TABLE "{temp}" RENAME TO "{name}"')
            for statement in extras:
                conn.execute(statement)
            after = conn.execute(f'SELECT count(*) FROM "{name}"').fetchone()[0]
            if before != after:
                raise RuntimeError(f"{name}: {before} rows before, {after} after")
            rebuilt.append(f"{name} ({after} rows)")
        conn.execute(f"PRAGMA user_version = {TARGET_VERSION}")
        integrity = conn.execute("PRAGMA integrity_check").fetchone()[0]
        if integrity != "ok":
            raise RuntimeError(f"integrity check: {integrity}")
        conn.execute("COMMIT")
    except Exception as error:  # any failure leaves the database exactly as it was
        conn.execute("ROLLBACK")
        print(f"migration failed, nothing changed: {error}", file=sys.stderr)
        return 1
    finally:
        conn.execute("PRAGMA legacy_alter_table=OFF")
    print("migrated: shifted " + ", ".join(shifted) + "; defaults rebuilt: " + (", ".join(rebuilt) or "none"))
    return 0


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(__doc__.strip().splitlines()[-1], file=sys.stderr)
        sys.exit(2)
    sys.exit(migrate(sys.argv[1]))
