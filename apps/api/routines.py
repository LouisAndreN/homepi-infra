"""Routines: recurring events the user declares (leaving for work, coming home, sleep...).

They are DECLARED, not measured: the dashboard draws them on the timeline (and through the charts) as
context for the measurements, and later as labels for NILM. Stored as runtime state in
/var/lib/homepi/dashboard/routines.json (directory owned by homepi-api, created by the provisioning_api
role; backed up nightly with /var/lib/homepi). Times are local wall-clock times ("07:45"); an end earlier than the start crosses
midnight (sleep 23:00 -> 07:00). Days: 0 = Monday ... 6 = Sunday.
"""
import json
import os
import re
from pathlib import Path
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

STATE_FILE = Path(os.environ.get("HOMEPI_ROUTINES_FILE", "/var/lib/homepi/dashboard/routines.json"))
HHMM = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


class Routine(BaseModel):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    label: str = Field(min_length=1, max_length=60)
    kind: Literal["away", "home", "sleep", "meal", "other"] = "other"
    days: list[int] = Field(min_length=1, max_length=7)
    start: str
    end: Optional[str] = None          # None: an instant (e.g. "leave for work")
    enabled: bool = True

    @field_validator("days")
    @classmethod
    def _days(cls, v):
        if any(d not in range(7) for d in v) or len(set(v)) != len(v):
            raise ValueError("days must be distinct integers 0 (Monday) to 6 (Sunday)")
        return sorted(v)

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, v):
        if v is not None and not HHMM.match(v):
            raise ValueError("times are HH:MM, 00:00 to 23:59")
        return v


class RoutineList(BaseModel):
    routines: list[Routine] = Field(max_length=100)

    @field_validator("routines")
    @classmethod
    def _unique_ids(cls, v):
        ids = [r.id for r in v]
        if len(set(ids)) != len(ids):
            raise ValueError("routine ids must be unique")
        return v


def load(path: Path = None) -> dict:
    p = path or STATE_FILE
    if not p.exists():
        return {"routines": []}
    return json.loads(p.read_text(encoding="utf-8"))


def save(data: RoutineList, path: Path = None) -> dict:
    p = path or STATE_FILE
    out = data.model_dump()
    tmp = p.with_name(f".{p.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    os.replace(tmp, p)
    return out
