#!/usr/bin/env python3
"""audit_exec_correlator.py — fusionne SYSCALL+EXECVE+CWD par ID d'audit,
   filtré strictement sur key="exec" (ignore network_connect, mount_operations,
   identity, etc. qui partagent le même audit.log)."""

import json, os, pwd, re, time, signal, sys

AUDIT_LOG    = "/var/log/audit/audit.log"
STATE_FILE   = "/var/lib/homepi/audit-exec-correlator.state"
OUTPUT_FILE  = "/var/log/homepi/exec-events.jsonl"
FLUSH_IDLE_S = 0.5
TARGET_KEY   = "exec"

AUDIT_ID_RE = re.compile(r"audit\((\d+\.\d+):(\d+)\)")
TYPE_RE     = re.compile(r"^type=(\S+)")
KV_RE       = re.compile(r'(\w+)=("[^"]*"|\S+)')

_uid_cache = {}
def resolve_user(uid_str):
    try: uid = int(uid_str)
    except ValueError: return uid_str
    if uid in (4294967295, -1): return "unset"
    if uid not in _uid_cache:
        try: _uid_cache[uid] = pwd.getpwuid(uid).pw_name
        except KeyError: _uid_cache[uid] = f"uid{uid}"
    return _uid_cache[uid]

def decode_arg(v):
    if re.fullmatch(r'[0-9A-Fa-f]+', v) and len(v) % 2 == 0 and v:
        try: return bytes.fromhex(v).decode('utf-8', errors='replace')
        except ValueError: return v
    return v

def parse_kv(line):
    out = {}
    for m in KV_RE.finditer(line):
        k, v = m.group(1), m.group(2)
        out[k] = v[1:-1] if v.startswith('"') and v.endswith('"') else v
    return out

def load_offset():
    try:
        with open(STATE_FILE) as f: return int(f.read().strip())
    except (FileNotFoundError, ValueError): return 0

def save_offset(pos):
    os.makedirs(os.path.dirname(STATE_FILE), exist_ok=True)
    with open(STATE_FILE, "w") as f: f.write(str(pos))

def emit(ev, out):
    if "comm" not in ev: return
    argv = [ev["argv"][i] for i in sorted(ev["argv"])]
    ts = ev.get("timestamp", time.time())
    out.write(json.dumps({
        "ts": ts,
        "ts_ms": int(ts * 1000),
        "user": ev.get("auid"),
        "effective_user": ev.get("euid"),
        "comm": ev.get("comm"), "exe": ev.get("exe"),
        "command": " ".join(argv) if argv else ev.get("comm"),
        "cwd": ev.get("cwd"),
        "success": ev.get("success"), "key": ev.get("key"),
    }) + "\n")

def process_line(line, events, skip_ids, out):
    id_match, type_match = AUDIT_ID_RE.search(line), TYPE_RE.match(line)
    if not id_match or not type_match: return

    audit_id, rtype = id_match.group(2), type_match.group(1)

    if rtype == "SYSCALL":
        kv = parse_kv(line)
        if kv.get("key") != TARGET_KEY:
            # Not our exec rule (network_connect, mount_operations, etc.)
            # -> skip the whole group, including the EXECVE/CWD lines
            # that follow for the same audit_id.
            skip_ids.add(audit_id)
            events.pop(audit_id, None)
            return
        ev = events.setdefault(audit_id, {"argv": {}, "_seen": time.time()})
        ev["_seen"] = time.time()
        ev.update({
            "timestamp": float(id_match.group(1)),
            "comm": kv.get("comm"), "exe": kv.get("exe"),
            "success": kv.get("success"),
            "auid": resolve_user(kv.get("auid", "-1")),
            "uid": resolve_user(kv.get("uid", "-1")),
            "euid": resolve_user(kv.get("euid", "-1")),
            "key": kv.get("key"),
        })
        return

    if audit_id in skip_ids or audit_id not in events:
        return
    ev = events[audit_id]
    ev["_seen"] = time.time()

    if rtype == "EXECVE":
        for k, v in parse_kv(line).items():
            if re.match(r"^a\d+$", k):
                ev["argv"][int(k[1:])] = decode_arg(v)
    elif rtype == "CWD":
        ev["cwd"] = parse_kv(line).get("cwd")
    elif rtype == "EOE":
        emit(ev, out)
        events.pop(audit_id, None)
        skip_ids.discard(audit_id)

    if len(events) > 5000:
        events.clear()
    if len(skip_ids) > 20000:
        skip_ids.clear()

def flush_idle(events, skip_ids, out):
    now = time.time()
    stale = [aid for aid, ev in events.items() if now - ev["_seen"] > FLUSH_IDLE_S]
    for aid in stale:
        emit(events[aid], out)
        events.pop(aid, None)
        skip_ids.discard(aid)

def main():
    os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
    events, skip_ids = {}, set()

    fb = open(AUDIT_LOG, "rb")
    saved = load_offset()
    file_size = os.fstat(fb.fileno()).st_size
    if saved > file_size:
        saved = 0
    fb.seek(saved)
    current_ino = os.fstat(fb.fileno()).st_ino

    def handle_sigterm(*_):
        save_offset(fb.tell()); sys.exit(0)
    signal.signal(signal.SIGTERM, handle_sigterm)
    signal.signal(signal.SIGINT, handle_sigterm)

    with open(OUTPUT_FILE, "a", buffering=1) as out:
        while True:
            raw = fb.readline()
            if not raw:
                save_offset(fb.tell())
                flush_idle(events, skip_ids, out)
                try:
                    new_ino = os.stat(AUDIT_LOG).st_ino
                except FileNotFoundError:
                    time.sleep(0.3); continue
                if new_ino != current_ino:
                    fb.close()
                    fb = open(AUDIT_LOG, "rb")
                    current_ino = new_ino
                    save_offset(0)
                else:
                    time.sleep(0.3)
                continue
            line = raw.decode("utf-8", errors="replace")
            process_line(line, events, skip_ids, out)

if __name__ == "__main__":
    main()
