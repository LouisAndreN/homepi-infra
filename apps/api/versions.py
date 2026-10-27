"""Firmware version helpers shared by the rollout check and the auto-OTA logic."""
import re

_RELEASE = re.compile(r"^[vV]?(\d+)\.(\d+)\.(\d+)")


def normalize(version):
    """Drop a leading 'v' so that 'v2.3.2' and '2.3.2' denote the same release."""
    version = (version or "").strip()
    return version[1:] if version[:1] in ("v", "V") else version


def same_version(a, b):
    """True when two version strings denote the same release.

    Suffixes such as '-dirty' or '-3-gabc1234' make a version different on purpose:
    a device running a modified build must not be reported as being on the release.
    """
    return normalize(a) == normalize(b)


def version_key(version):
    """Numeric (major, minor, patch) sort key; unparseable versions sort first."""
    match = _RELEASE.match((version or "").strip())
    if not match:
        return (-1, -1, -1)
    return tuple(int(part) for part in match.groups())
