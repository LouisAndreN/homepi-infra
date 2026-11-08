#!/usr/bin/env python3
"""Host hardening audit (verify only). Prints JSON.

exposed: world-writable files and non-sticky directories under ROOTS that every
local account can reach (every parent directory traversable by others). An
entry under a parent closed to others is contained, not exposed.

venvs: for each virtualenv, installed files whose sha256 does not match any
RECORD entry for that path. Read with the system Python, without importing code
from the virtualenv. A path recorded by two packages (RPi.GPIO overwriting
rpi-lgpio) matches when it equals either record.
"""
import base64
import csv
import glob
import hashlib
import json
import os
import stat
import sys

ROOTS = ["/etc", "/opt", "/usr/local", "/var/www", "/srv"]


def reachable(path):
    parent = os.path.dirname(path)
    while True:
        try:
            st = os.stat(parent)
        except OSError:
            return False
        if not st.st_mode & stat.S_IXOTH:
            return False
        if parent == "/":
            return True
        parent = os.path.dirname(parent)


def world_writable():
    exposed = []
    for root in ROOTS:
        if not os.path.isdir(root):
            continue
        dev = os.lstat(root).st_dev
        for d, dirs, files in os.walk(root):
            dirs[:] = [x for x in dirs if os.lstat(os.path.join(d, x)).st_dev == dev]
            for name in dirs + files:
                p = os.path.join(d, name)
                try:
                    st = os.lstat(p)
                except OSError:
                    continue
                if stat.S_ISLNK(st.st_mode) or not st.st_mode & stat.S_IWOTH:
                    continue
                if stat.S_ISDIR(st.st_mode) and st.st_mode & stat.S_ISVTX:
                    continue
                if reachable(p):
                    exposed.append(p)
    return sorted(exposed)


def digest(path):
    with open(path, "rb") as f:
        return base64.urlsafe_b64encode(hashlib.sha256(f.read()).digest()).rstrip(b"=").decode()


def venv_audit(venv):
    records = {}
    for sp in glob.glob(os.path.join(venv, "lib", "python*", "site-packages")):
        for rec in glob.glob(os.path.join(sp, "*.dist-info", "RECORD")):
            with open(rec, newline="") as f:
                for row in csv.reader(f):
                    if len(row) >= 2 and row[1].startswith("sha256="):
                        path = os.path.normpath(os.path.join(sp, row[0]))
                        records.setdefault(path, set()).add(row[1][7:])
    checked, modified, missing = 0, [], []
    for path, hashes in sorted(records.items()):
        try:
            got = digest(path)
        except FileNotFoundError:
            missing.append(path)
            continue
        checked += 1
        if got not in hashes:
            modified.append(path)
    return {"checked": checked, "modified": modified, "missing": missing,
            "shared_paths": sum(1 for h in records.values() if len(h) > 1)}


venvs = json.loads(sys.argv[1]) if len(sys.argv) > 1 else []
print(json.dumps({"exposed": world_writable(), "venvs": {v: venv_audit(v) for v in venvs}}))
