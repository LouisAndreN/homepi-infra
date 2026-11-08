#!/usr/bin/env python3
"""Check a dashboard build before it is served.

Every local asset referenced by index.html must exist, and no file may embed an
InfluxDB token (VITE_INFLUX_TOKEN or any 'Token <80+ chars>' value): since
v0.1.61 nginx adds the token server-side.
"""
import pathlib
import re
import sys

dist = pathlib.Path(sys.argv[1])
index = (dist / "index.html").read_text()
refs = re.findall(r'(?:src|href)="(/[^"#?]+)"', index)
missing = [r for r in refs if not (dist / r.lstrip("/")).exists()]
leaks = []
for p in dist.rglob("*"):
    if p.is_file() and p.suffix in {".js", ".html", ".css", ".json", ".webmanifest"}:
        data = p.read_bytes()
        if b"VITE_INFLUX_TOKEN" in data or re.search(rb"Token [A-Za-z0-9_=-]{80,}", data):
            leaks.append(str(p.relative_to(dist)))
print(f"local references: {len(refs)}, missing: {missing}, files with a token: {leaks}")
sys.exit(1 if missing or leaks or not refs else 0)
