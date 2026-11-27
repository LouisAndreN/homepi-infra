"""NILM calibration state: the single file the Pi uses to turn raw NILM values into physical ones.

The file /var/lib/homepi/nilm/calibration.json is runtime STATE, not configuration: the dashboard
calibration wizard writes it through the admin API, the Telegraf processor homepi-nilm-calibrate
reads it and reloads it when it changes, and the nightly state backup carries it (it lives under
/var/lib/homepi). GitOps does not manage its content, only the directory, its owner and its mode.

Schema 1:
{
  "schema": 1, "version": 7, "updated_at": "2026-11-28T10:12:00Z",
  "V_scale": 198.69,
  "voltage": {"reference_V": 101.3, "method": "multimeter", "V_n": 0.5098, "calibrated_at": "..."},
  "cts": {
    "1": {"I_scale": 59.22, "phi_deg": -1.47, "calibrated_at": "...",
          "reference": {"method": "clamp_meter", "value": 11.9, "unit": "A", "P_ref_W": 1205.5},
          "measured": {"dP_n": ..., "dQ_n": ..., "baseline_std_ratio": 0.004, "points_on": 13}}
  }
}
The processor only needs V_scale and, per CT, I_scale and phi_deg; the rest is evidence for audits.
Every accepted write appends the previous state to calibration-history.jsonl.
"""
import json
import math
import os
import time
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

STATE_DIR = Path(os.environ.get("HOMEPI_NILM_STATE_DIR", "/var/lib/homepi/nilm"))
CAL_FILE = "calibration.json"
HISTORY_FILE = "calibration-history.jsonl"
HISTORY_KEEP = 200

# Wide sanity bounds around the analogue front end (nominal ~198.6 V and ~59.2 A per full-scale
# unit): they catch a unit mistake (mA, kW) or a wrong leg, not a few percent of error.
V_SCALE_RANGE = (50.0, 800.0)
I_SCALE_RANGE = (5.0, 500.0)


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class VoltageCal(BaseModel):
    V_scale: float
    reference_V: float = Field(gt=80, lt=130)          # Japanese 100 V mains, legal 101 +/- 6 V
    method: Literal["multimeter", "nominal"]
    V_n: float = Field(gt=0)

    @field_validator("V_scale")
    @classmethod
    def _v_range(cls, v):
        if not (V_SCALE_RANGE[0] <= v <= V_SCALE_RANGE[1]) or not math.isfinite(v):
            raise ValueError(f"V_scale {v} outside {V_SCALE_RANGE}")
        return v


class CtReference(BaseModel):
    method: Literal["clamp_meter", "plug_wattmeter", "nameplate"]
    value: float = Field(gt=0)
    unit: Literal["A", "W"]
    P_ref_W: float = Field(gt=100, lt=3000)      # a kettle-class resistive load


class CtMeasured(BaseModel):
    dP_n: float
    dQ_n: float
    baseline_std_ratio: float = Field(ge=0)      # baseline noise / kettle step, both CTs
    other_ct_ratio: float = Field(ge=0)          # step seen on the other CT / step on this CT
    points_on: int = Field(ge=5)
    points_off: int = Field(ge=5)


class CtCal(BaseModel):
    I_scale: float
    phi_deg: float = Field(ge=-180, le=180)
    reference: CtReference
    measured: CtMeasured

    @field_validator("I_scale")
    @classmethod
    def _i_range(cls, v):
        if not (I_SCALE_RANGE[0] <= v <= I_SCALE_RANGE[1]) or not math.isfinite(v):
            raise ValueError(f"I_scale {v} outside {I_SCALE_RANGE}")
        return v


class CalibrationUpdate(BaseModel):
    """A wizard run: voltage and/or any subset of CTs. Omitted parts keep their current value."""
    voltage: Optional[VoltageCal] = None
    cts: dict[Literal["1", "2"], CtCal] = {}
    note: str = Field(default="", max_length=500)


def _paths(state_dir: Path = None):
    d = state_dir or STATE_DIR
    return d, d / CAL_FILE, d / HISTORY_FILE


def load(state_dir: Path = None) -> dict:
    _, cal, _ = _paths(state_dir)
    if not cal.exists():
        return {"schema": 1, "version": 0, "updated_at": None, "V_scale": None, "voltage": None, "cts": {}}
    return json.loads(cal.read_text(encoding="utf-8"))


def merge(current: dict, upd: CalibrationUpdate) -> dict:
    """New state from the current one and a wizard run. Pure (no I/O), unit-tested."""
    if upd.voltage is None and not upd.cts:
        raise ValueError("nothing to calibrate")
    new = json.loads(json.dumps(current))      # deep copy
    now = _now()
    if upd.voltage is not None:
        new["V_scale"] = upd.voltage.V_scale
        new["voltage"] = {**upd.voltage.model_dump(exclude={"V_scale"}), "calibrated_at": now}
    if new.get("V_scale") is None:
        raise ValueError("the voltage must be calibrated before (or with) the first CT")
    cts = dict(new.get("cts") or {})
    for k, ct in upd.cts.items():
        cts[k] = {**ct.model_dump(), "calibrated_at": now}
    new.update({"schema": 1, "version": int(current.get("version") or 0) + 1, "updated_at": now,
                "cts": cts, "note": upd.note})
    return new


def save(new: dict, state_dir: Path = None) -> None:
    """Atomic replace (the processor never reads a half-written file); history appended first."""
    d, cal, hist = _paths(state_dir)
    if cal.exists():
        with open(hist, "a", encoding="utf-8") as fh:
            fh.write(cal.read_text(encoding="utf-8").strip().replace("\n", " ") + "\n")
        lines = hist.read_text(encoding="utf-8").splitlines()
        if len(lines) > HISTORY_KEEP:
            hist.write_text("\n".join(lines[-HISTORY_KEEP:]) + "\n", encoding="utf-8")
    tmp = d / f".{CAL_FILE}.{os.getpid()}.tmp"
    tmp.write_text(json.dumps(new, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o640)        # group telegraf comes from the setgid directory
    os.replace(tmp, cal)


def history(state_dir: Path = None, limit: int = 50) -> list:
    _, _, hist = _paths(state_dir)
    if not hist.exists():
        return []
    out = []
    for line in hist.read_text(encoding="utf-8").splitlines()[-limit:]:
        try:
            d = json.loads(line)
            out.append({"version": d.get("version"), "updated_at": d.get("updated_at"),
                        "V_scale": d.get("V_scale"),
                        "cts": {k: {"I_scale": v.get("I_scale"), "phi_deg": v.get("phi_deg"),
                                    "calibrated_at": v.get("calibrated_at")} for k, v in (d.get("cts") or {}).items()}})
        except json.JSONDecodeError:
            continue
    return list(reversed(out))
