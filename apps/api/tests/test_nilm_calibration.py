"""NILM calibration state: merge rules, bounds, atomic save with history, admin routes."""
import importlib
import json
import os
import stat
import sys

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
import nilm_calibration as nc  # noqa: E402

V = {"V_scale": 198.7, "reference_V": 101.3, "method": "multimeter", "V_n": 0.5098}


def ct(I_scale=59.2, phi=-1.5):
    return {"I_scale": I_scale, "phi_deg": phi,
            "reference": {"method": "clamp_meter", "value": 11.9, "unit": "A", "P_ref_W": 1205.5},
            "measured": {"dP_n": 0.1, "dQ_n": -0.002, "baseline_std_ratio": 0.004,
                         "other_ct_ratio": 0.01, "points_on": 13, "points_off": 13}}


def test_first_ct_needs_the_voltage():
    with pytest.raises(ValueError, match="voltage"):
        nc.merge({"version": 0, "V_scale": None, "cts": {}}, nc.CalibrationUpdate(cts={"1": ct()}))


def test_merge_keeps_the_other_ct_and_bumps_the_version():
    s1 = nc.merge({"version": 0, "V_scale": None, "cts": {}}, nc.CalibrationUpdate(voltage=V, cts={"1": ct()}))
    s2 = nc.merge(s1, nc.CalibrationUpdate(cts={"2": ct(58.1, 178.2)}))
    assert (s1["version"], s2["version"]) == (1, 2)
    assert s2["cts"]["1"]["I_scale"] == 59.2 and s2["cts"]["2"]["phi_deg"] == 178.2
    assert s2["V_scale"] == 198.7 and s2["voltage"]["method"] == "multimeter"


@pytest.mark.parametrize("bad", [
    {"cts": {"1": ct(I_scale=0.059)}},                 # mA instead of A: caught by the bounds
    {"cts": {"1": ct(phi=270)}},
    {"cts": {"3": ct()}},
    {"voltage": V | {"V_scale": 1.987}},
    {"voltage": V | {"reference_V": 200}},             # 200 V outlet is not the measured leg-to-N voltage
])
def test_bounds(bad):
    with pytest.raises(Exception):
        nc.CalibrationUpdate(**bad)


def test_nothing_to_calibrate():
    with pytest.raises(ValueError):
        nc.merge({"version": 3, "V_scale": 198.7, "cts": {}}, nc.CalibrationUpdate())


def test_save_is_atomic_and_keeps_history(tmp_path):
    s1 = nc.merge(nc.load(tmp_path), nc.CalibrationUpdate(voltage=V, cts={"1": ct()}))
    nc.save(s1, tmp_path)
    s2 = nc.merge(nc.load(tmp_path), nc.CalibrationUpdate(cts={"2": ct(58.1, 178.2)}))
    nc.save(s2, tmp_path)
    assert nc.load(tmp_path)["version"] == 2
    assert stat.S_IMODE(os.stat(tmp_path / nc.CAL_FILE).st_mode) == 0o640
    assert [h["version"] for h in nc.history(tmp_path)] == [1]
    assert not list(tmp_path.glob(".*.tmp"))
    # what the processor reads: V_scale + per-CT I_scale/phi_deg
    d = json.loads((tmp_path / nc.CAL_FILE).read_text())
    assert d["schema"] == 1 and set(d["cts"]) == {"1", "2"}


def test_admin_routes(monkeypatch, tmp_path):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    monkeypatch.setenv("HOMEPI_API_SURFACE", "admin")
    monkeypatch.setattr(nc, "STATE_DIR", tmp_path)
    import provisioning_api
    importlib.reload(provisioning_api)
    monkeypatch.setattr(provisioning_api.nilm_calibration, "STATE_DIR", tmp_path)
    monkeypatch.setattr(provisioning_api, "audit", lambda *a, **k: None)
    c = TestClient(provisioning_api.app)
    assert c.get("/api/admin/nilm/calibration").json()["version"] == 0
    assert c.put("/api/admin/nilm/calibration", json={"cts": {"1": ct()}}).status_code == 422
    r = c.put("/api/admin/nilm/calibration", json={"voltage": V, "cts": {"1": ct()}, "note": "kettle"})
    assert r.status_code == 200 and r.json()["version"] == 1
    assert c.get("/api/admin/nilm/calibration/history").json() == {"history": []}


def test_device_surface_refuses_calibration(monkeypatch):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    monkeypatch.setenv("HOMEPI_API_SURFACE", "device")
    import provisioning_api
    importlib.reload(provisioning_api)
    c = TestClient(provisioning_api.app)
    assert c.put("/api/admin/nilm/calibration", json={}).status_code == 404
