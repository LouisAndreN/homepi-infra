import sys; sys.dont_write_bytecode = True  # never leave a .pyc next to the deployed script
import datetime as dt, importlib.machinery, importlib.util, io, json, os, tempfile, urllib.error
loader = importlib.machinery.SourceFileLoader("w", os.path.join(os.path.dirname(__file__), "..", "files", "homepi-weather"))
spec = importlib.util.spec_from_loader("w", loader); w = importlib.util.module_from_spec(spec); loader.exec_module(w)

fails = 0
def ok(c, m):
    global fails
    fails += not c
    print(f"  {'ok ' if c else 'BAD'} {m}")

HOME = (35.68, 139.77)   # test location (Tokyo station area), not anyone's home
ok(w.location({"HOMEPI_WEATHER_LAT": "35.68", "HOMEPI_WEATHER_LON": "139.77"}) == HOME, "location read")
for env, why in [({}, "missing"), ({"HOMEPI_WEATHER_LAT": "x", "HOMEPI_WEATHER_LON": "1"}, "not a number"),
                 ({"HOMEPI_WEATHER_LAT": "48.85", "HOMEPI_WEATHER_LON": "2.35"}, "outside Japan")]:
    try: w.location(env); ok(False, f"location {why} refused")
    except SystemExit: ok(True, f"location {why} refused")

# Station table as JMA serves it: lat/lon in [degrees, minutes]
TABLE = {"44132": {"lat": [35, 41.5], "lon": [139, 45.0], "kjName": "東京"},        # ~1.5 km, no sunshine meter here (test)
         "44136": {"lat": [35, 38.0], "lon": [139, 40.0], "kjName": "練馬"},        # ~8 km, sunshine
         "46106": {"lat": [35, 26.0], "lon": [139, 39.0], "kjName": "far"},         # ~28 km
         "bad": {"kjName": "no position"}}
ok(abs(w.deg([35, 41.5]) - 35.691667) < 1e-5, "degrees + minutes")
ok(abs(w.dist_km(35.68, 139.77, 35.69, 139.77) - 1.11) < 0.01, "distance")
OBS = {"44132": {"temp": [8.4, 0], "precipitation1h": [0.0, 0], "sun1h": [None, 5]},
       "44136": {"temp": [8.1, 0], "precipitation1h": [0.0, 0], "sun1h": [0.8, 0]},
       "46106": {"temp": [9.0, 0], "precipitation1h": [2.0, 0], "sun1h": [0.0, 0]}}
ok(w.nearest(TABLE, OBS, *HOME, "temp")[0] == "44132", "nearest station with a temperature")
ok(w.nearest(TABLE, OBS, *HOME, "sun1h")[0] == "44136", "sunshine: nearest station that has a value this hour")
ok(w.nearest(TABLE, {"46106": OBS["46106"]}, *HOME, "temp", max_km=20) is None, "no station within range: none")

# Weather code from observations
cases = [((0.0, 10, 0.9, 60), 0), ((0.0, 10, 0.3, 60), 2), ((0.0, 10, 0.05, 60), 3), ((0.0, 10, 0.4, 40), 2),
         ((0.5, 10, None, 60), 61), ((4.0, 10, 0, 0), 63), ((12.0, 10, 0, 0), 65), ((0.5, 1.0, 0, 0), 71), ((2.0, 0.0, 0, 0), 73),
         ((0.0, 10, None, 60), None), ((0.0, 5, 0.0, 10), None), ((None, None, None, 0), None)]
for args, exp in cases:
    ok(w.derive_code(*args) == exp, f"code{args} = {exp}")

# Sun: Tokyo on 2026-11-28, about 06:28 and 16:28 JST
rise, sset = w.sun_times(*HOME, dt.date(2026, 11, 28))
r, s = dt.datetime.fromtimestamp(rise, w.JST), dt.datetime.fromtimestamp(sset, w.JST)
ok((r.hour, r.minute // 10) == (6, 2) and (s.hour, s.minute // 10) == (16, 2), f"sunrise {r:%H:%M}, sunset {s:%H:%M}")
H = lambda h: dt.datetime(2026, 11, 28, h, tzinfo=w.JST).timestamp()
ok(w.daylight_minutes(H(12), *HOME) == 60 and w.daylight_minutes(H(2), *HOME) == 0 and 25 < w.daylight_minutes(H(6), *HOME) < 40, "daylight minutes per hour")

# One hour: totals of the 12:00 file describe 11:00-12:00, stamped at 11:00
line = w.hour_line(OBS, TABLE, H(12), *HOME)
ok(line == f"weather,source=jma-amedas code=0i,precip=0.0,sun=0.80,temp=8.4,is_day=1i,dist_km={w.nearest(TABLE, OBS, *HOME, 'sun1h')[1]:.1f} {int(H(11))}000000000", line)
night = w.hour_line(OBS, TABLE, H(3), *HOME)
ok("code=" not in night and "is_day=0i" in night, "dry night hour: no code (cloud cover not observed)")
ok(w.hour_line({}, TABLE, H(12), *HOME) is None, "empty file: no point")
d = w.daily_lines(*HOME, [dt.date(2026, 11, 28)])
ok(d == [f"weather_daily,source=local sunrise={int(rise)}i,sunset={int(sset)}i {int(H(0))}000000000"], "daily line at local midnight")

# Live run: state file, only new hours, 404 tolerated; no request carries the location
urls = []
def fake_bytes(url, timeout=20):
    urls.append(url)
    if url.endswith("amedastable.json"): return json.dumps(TABLE).encode()
    if url.endswith("20261128130000.json"): raise urllib.error.HTTPError(url, 404, "nf", {}, io.BytesIO())
    return json.dumps(OBS).encode()
w.fetch_bytes = fake_bytes
w.fetch_text = lambda url, timeout=20: (urls.append(url), "2026-11-28T14:20:00+09:00")[1]
with tempfile.TemporaryDirectory() as tmp:
    w.STATE = os.path.join(tmp, "state.json")
    w.ARCHIVE = os.path.join(tmp, "amedas")
    json.dump({"last_end": int(H(11))}, open(w.STATE, "w"))
    os.environ.update(HOMEPI_WEATHER_LAT="35.68", HOMEPI_WEATHER_LON="139.77")
    out = io.StringIO(); real = sys.stdout; sys.stdout = out
    rc = w.main(["homepi-weather"]); sys.stdout = real
    got = out.getvalue().splitlines()
    st = json.load(open(w.STATE))
    ok(rc == 0 and [l.rsplit(" ", 1)[1] for l in got if l.startswith("weather,")] == [f"{int(H(11))}000000000", f"{int(H(13))}000000000"],
       "live: hours ending 12:00 and 14:00 written, 13:00 (404) skipped")
    ok(st["last_end"] == int(H(14)) and st["table_day"] == "2026-11-28", "state: last hour written and the table of the day kept")
    ok(sum(l.startswith("weather_daily") for l in got) == 2, "daily lines for yesterday and today")
    urls.clear(); sys.stdout = io.StringIO(); w.main(["homepi-weather"]); sys.stdout = real
    ok(all("amedastable" not in u for u in urls), "second run: table from the state, not fetched again")
    ok(not any("35.6" in u or "139.7" in u for u in urls), "no request carries the location")
    # Archive: national files kept as served, the table once per content; reprocess works offline
    import glob as g
    files = sorted(os.path.relpath(f, w.ARCHIVE) for f in g.glob(os.path.join(w.ARCHIVE, "**", "*.json.gz"), recursive=True))
    ok(files[:2] == ["2026/11/2812.json.gz", "2026/11/2814.json.gz"] and len([f for f in files if f.startswith("tables/")]) == 1,
       f"archive: hours fetched and one station table ({files})")
    import gzip as gz
    ok(json.load(gz.open(os.path.join(w.ARCHIVE, "2026/11/2812.json.gz"))) == OBS, "archived file identical to what JMA served")
    w.fetch_bytes = lambda *a, **k: (_ for _ in ()).throw(AssertionError("network used"))
    err = io.StringIO(); real_err = sys.stderr; sys.stderr = err; sys.stdout = io.StringIO()
    rc = w.main(["homepi-weather", "--reprocess", "2026-11-28", "2026-11-28"]); sys.stdout = real; sys.stderr = real_err
    ok(rc == 0 and "22 hours not in the archive" in err.getvalue(), f"reprocess from the archive, no network ({err.getvalue().strip()})")

print("FAILED" if fails else "all ok"); sys.exit(1 if fails else 0)
