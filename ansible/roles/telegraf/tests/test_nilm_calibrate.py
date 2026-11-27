import sys; sys.dont_write_bytecode = True  # never leave a .pyc next to the deployed script
import importlib.util, importlib.machinery, json, math, os, subprocess, sys, tempfile, time
loader = importlib.machinery.SourceFileLoader("cal", os.path.join(os.path.dirname(__file__), "..", "files", "homepi-nilm-calibrate"))
spec = importlib.util.spec_from_loader("cal", loader); cal = importlib.util.module_from_spec(spec); loader.exec_module(cal)

def raw_for(V, I, theta_deg, Vs, Is, phi_deg):
    """Raw normalised values the Teensy would send for a load, given the hardware phase error phi."""
    a = math.radians(theta_deg + phi_deg)
    Vn, In = V / Vs, I / Is
    return Vn, In, Vn * In * math.cos(a), Vn * In * math.sin(a)

Vs, I1s, I2s, phi1, phi2 = 198.69, 59.22, 58.10, -1.47, 178.2   # CT2 reversed
calib = {"schema": 1, "version": 4, "V_scale": Vs,
         "cts": {"1": {"I_scale": I1s, "phi_deg": phi1}, "2": {"I_scale": I2s, "phi_deg": phi2}}}
c = cal.validate(calib)
fails = 0
def check(name, got, exp, tol):
    global fails
    ok = abs(got - exp) <= tol
    fails += not ok
    print(f"  {'ok ' if ok else 'BAD'} {name}: {got:.3f} (expected {exp:.3f})")

print("conversion")
for (V, I, th, name) in [(101.3, 12.3, 0, "kettle"), (101.3, 1.2, 45.6, "fridge"), (100.8, 0.9, -30, "capacitive")]:
    Vn, In, Pn, Qn = raw_for(V, I, th, Vs, I2s, phi2)
    out = cal.convert({"V_n": Vn, "I2_n": In, "P2_n": Pn, "Q2_n": Qn}, c)
    check(f"{name} P_L2", out["P_L2"], V * I * math.cos(math.radians(th)), 0.01)
    check(f"{name} Q_L2", out["Q_L2"], V * I * math.sin(math.radians(th)), 0.01)
    check(f"{name} PF_L2", out["PF_L2"], math.cos(math.radians(th)), 1e-4)

print("line protocol")
Vn, In, Pn, Qn = raw_for(101.3, 12.3, 0, Vs, I1s, phi1)
line = f"nilm_readings,device_id=esp32-690be854,hw_model=xiao\\ s3 V_n={Vn},I1_n={In},P1_n={Pn},Q1_n={Qn},I2_n=0,P2_n=0,Q2_n=0,cycles=90i,dS_n=0.0042 1795770851000000000"
out = cal.process_line(line, c)
p = cal.parse_line(out)
f = dict(p[2])
check("P_L1 in line", float(f["P_L1"]), 101.3 * 12.3, 0.01)
print("  tags kept:", p[0] == "nilm_readings,device_id=esp32-690be854,hw_model=xiao\\ s3", "| ts kept:", p[3] == "1795770851000000000", "| raw kept:", "P1_n" in f, "| version:", f["calib_version"])
v2 = "nilm_readings,device_id=x P_L1=1006.9,V_rms=105.3 1795770851000000000"
print("  v2 line untouched:", cal.process_line(v2, c) == v2)
other = "iot_sensors,device_id=x temperature=21.5 1"
print("  other measurement untouched:", cal.process_line(other, c) == other)
partial = cal.validate({"schema": 1, "version": 1, "V_scale": Vs, "cts": {"1": {"I_scale": I1s, "phi_deg": phi1}}})
o2 = dict(cal.parse_line(cal.process_line(line, partial))[2])
print("  uncalibrated CT2 gets no P_L2:", "P_L2" not in o2 and "P_L1" in o2)
print("  no calibration -> line untouched:", cal.process_line(line, None) == line)

print("execd process: hot reload + invalid file keeps last good")
d = tempfile.mkdtemp(); path = os.path.join(d, "calibration.json")
json.dump(calib, open(path, "w"))
pr = subprocess.Popen([sys.executable, os.path.join(os.path.dirname(__file__), "..", "files", "homepi-nilm-calibrate"), "--config", path],
                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
def send(l): pr.stdin.write(l + "\n"); pr.stdin.flush(); return pr.stdout.readline().strip()
v1 = dict(cal.parse_line(send(line))[2])["calib_version"]
calib2 = dict(calib, version=5); calib2["cts"] = dict(calib["cts"], **{"1": {"I_scale": I1s * 1.1, "phi_deg": phi1}})
time.sleep(1.1); json.dump(calib2, open(path + ".tmp", "w")); os.replace(path + ".tmp", path); time.sleep(0.05)
r2 = dict(cal.parse_line(send(line))[2])
time.sleep(1.1); open(path, "w").write("{ broken"); time.sleep(0.05)
r3 = dict(cal.parse_line(send(line))[2])
pr.stdin.close(); err = pr.stderr.read(); pr.wait()
print(f"  version {v1} -> {r2['calib_version']} after rewrite, P_L1 {float(r2['P_L1']):.1f} (x1.1 scale); after broken file: version {r3['calib_version']}")
lines = [l for l in err.strip().splitlines() if l]
print("  stderr:", " | ".join(lines))
fails += not (v1 == "4.0" and r2["calib_version"] == "5.0" and r3["calib_version"] == "5.0")
# Telegraf turns every stderr line into an "E!" error and the role fails its test run on "E!":
# loading a good file (or a missing one) must print nothing, only the broken file may.
fails += not (len(lines) == 1 and "invalid" in lines[0])
pr2 = subprocess.Popen([sys.executable, os.path.join(os.path.dirname(__file__), "..", "files", "homepi-nilm-calibrate"), "--config", path + ".absent"],
                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
out2, err2 = pr2.communicate(line + "\n")
print("  missing file: line passed through:", out2.strip() == line, "| stderr empty:", err2 == "")
fails += not (out2.strip() == line and err2 == "")
print("FAILS:", fails)
