#!/usr/bin/env python3
"""Content hash of a source tree: sorted relative paths and the sha256 of each file.

Independent of git, because the release precheck runs on an exported copy
without .git. node_modules, dist and .git are ignored.
"""
import hashlib
import os
import sys

root = sys.argv[1]
h = hashlib.sha256()
for d, dirs, files in os.walk(root):
    dirs[:] = sorted(x for x in dirs if x not in ("node_modules", "dist", ".git"))
    for name in sorted(files):
        path = os.path.join(d, name)
        rel = os.path.relpath(path, root).replace(os.sep, "/")
        with open(path, "rb") as f:
            h.update(rel.encode() + b"\0" + hashlib.sha256(f.read()).digest())
print(h.hexdigest())
