import sys; sys.dont_write_bytecode = True  # never leave a .pyc next to the deployed script
import importlib.machinery, importlib.util, os, urllib.parse
loader = importlib.machinery.SourceFileLoader("w", os.path.join(os.path.dirname(__file__), "..", "files", "homepi-weather"))
spec = importlib.util.spec_from_loader("w", loader); w = importlib.util.module_from_spec(spec); loader.exec_module(w)

fails = 0
def ok(c, m):
    global fails
    fails += not c
    print(f"  {'ok ' if c else 'BAD'} {m}")

# Location: rounded to 2 decimals, refused when missing, not a number or out of range
ok(w.location({"HOMEPI_WEATHER_LAT": "35.6812", "HOMEPI_WEATHER_LON": "139.7671"}) == (35.68, 139.77), "location rounded to 2 decimals")
for env, why in [({}, "missing"), ({"HOMEPI_WEATHER_LAT": "x", "HOMEPI_WEATHER_LON": "1"}, "not a number"),
                 ({"HOMEPI_WEATHER_LAT": "95", "HOMEPI_WEATHER_LON": "1"}, "out of range")]:
    try: w.location(env); ok(False, f"location {why} refused")
    except SystemExit: ok(True, f"location {why} refused")

u = urllib.parse.urlparse(w.build_url(w.LIVE_URL, 35.68, 139.77, past_days=2, forecast_days=1))
q = urllib.parse.parse_qs(u.query)
ok(q["timeformat"] == ["unixtime"] and q["timezone"] == ["Asia/Tokyo"] and q["past_days"] == ["2"], "live URL: unixtime, Tokyo days, 2 past days")
ok(q["hourly"] == ["weather_code,temperature_2m,precipitation,cloud_cover,is_day"] and q["daily"] == ["sunrise,sunset"], "live URL: variables")

H0 = 1795791600   # 2026-11-28 00:00 JST
doc = {"hourly": {"time": [H0, H0 + 3600, H0 + 7200, H0 + 10800],
                  "weather_code": [0, 61, None, 3], "temperature_2m": [8.04, 7.5, 7.0, None],
                  "precipitation": [0, 1.234, 0, 0], "cloud_cover": [5, 100, 90, 80], "is_day": [0, 0, 0, 1]},
       "daily": {"time": [H0, H0 + 86400], "sunrise": [H0 + 23000, H0 + 109500], "sunset": [H0 + 59000, H0 + 145400]}}
lines = w.to_lines(doc, now_s=H0 + 10800)
ok(lines[0] == f"weather,source=open-meteo code=0i,temp=8.0,precip=0.00,cloud=5i,is_day=0i {H0}000000000", "hour point: fields and timestamp in ns")
ok(lines[1].startswith("weather,source=open-meteo code=61i,temp=7.5,precip=1.23,"), "rain hour, values rounded")
ok(sum(l.startswith("weather,") for l in lines) == 3, "hour without a weather code skipped")
ok(any(l.startswith("weather,source=open-meteo code=3i,precip=0.00,cloud=80i,is_day=1i") for l in lines), "missing temperature: field left out, point kept")
ok([l for l in lines if l.startswith("weather_daily")] == [f"weather_daily,source=open-meteo sunrise={H0 + 23000}i,sunset={H0 + 59000}i {H0}000000000"],
   "daily: today only (tomorrow not started), sunrise and sunset in seconds")
ok(len(w.to_lines(doc, now_s=H0 + 3599)) == 2, "hours that have not started are not written (no forecast)")
ok(w.to_lines({}, now_s=H0) == [], "empty response: no lines")

print("FAILED" if fails else "all ok"); sys.exit(1 if fails else 0)
