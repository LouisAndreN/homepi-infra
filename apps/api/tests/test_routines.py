"""Routines: validation, atomic save, admin routes only."""
import importlib
import os
import sys

import pytest

HERE = os.path.dirname(__file__)
sys.path.insert(0, os.path.join(HERE, ".."))
import routines  # noqa: E402

OK = {"id": "work-out", "label": "Leave for work", "kind": "away", "days": [4, 0, 1, 2, 3], "start": "07:45"}


def test_valid_and_days_sorted():
    r = routines.RoutineList(routines=[OK, {"id": "sleep", "label": "Sleep", "kind": "sleep", "days": [0, 1, 2, 3, 4, 5, 6], "start": "23:30", "end": "07:00"}])
    assert r.routines[0].days == [0, 1, 2, 3, 4] and r.routines[1].end == "07:00"


@pytest.mark.parametrize("bad", [
    OK | {"start": "7:45"}, OK | {"start": "24:00"}, OK | {"days": []}, OK | {"days": [7]}, OK | {"days": [1, 1]},
    OK | {"id": "a b"}, OK | {"label": ""}, OK | {"kind": "party"},
])
def test_invalid(bad):
    with pytest.raises(Exception):
        routines.RoutineList(routines=[bad])


def test_unique_ids():
    with pytest.raises(Exception):
        routines.RoutineList(routines=[OK, OK])


def test_save_load(tmp_path):
    p = tmp_path / "routines.json"
    routines.save(routines.RoutineList(routines=[OK]), p)
    assert routines.load(p)["routines"][0]["label"] == "Leave for work"
    assert not list(tmp_path.glob(".*.tmp"))


def test_routes(monkeypatch, tmp_path):
    pytest.importorskip("httpx")
    from fastapi.testclient import TestClient
    monkeypatch.setenv("HOMEPI_API_SURFACE", "admin")
    import provisioning_api
    importlib.reload(provisioning_api)
    monkeypatch.setattr(provisioning_api.routines, "STATE_FILE", tmp_path / "routines.json")
    monkeypatch.setattr(provisioning_api, "audit", lambda *a, **k: None)
    c = TestClient(provisioning_api.app)
    assert c.get("/api/admin/routines").json() == {"routines": []}
    assert c.put("/api/admin/routines", json={"routines": [OK | {"start": "25:00"}]}).status_code == 422
    assert c.put("/api/admin/routines", json={"routines": [OK]}).status_code == 200
    assert c.get("/api/admin/routines").json()["routines"][0]["id"] == "work-out"
