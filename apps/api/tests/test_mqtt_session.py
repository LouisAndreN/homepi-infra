"""One MQTT session per API instance, and the sensor subscription survives reconnections (v0.1.112).

Both instances used the client id "homepi-api": the broker closed one connection each time the other
connected (about one takeover per second), and the subscription made once outside on_connect was lost.
"""
import importlib
import os
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _api(monkeypatch, surface):
    monkeypatch.setenv("HOMEPI_API_SURFACE", surface)
    import provisioning_api
    return importlib.reload(provisioning_api)


class FakeClient:
    def __init__(self):
        self.subscriptions = []

    def subscribe(self, topic, qos=0):
        self.subscriptions.append(topic)


def test_instances_use_distinct_client_ids(monkeypatch):
    ids = {_api(monkeypatch, s)._mqtt_client_id() for s in ("device", "admin")}
    assert ids == {"homepi-api-device", "homepi-api-admin"}


@pytest.mark.parametrize("surface,expected", [("device", ["iot/+/sensors"]), ("admin", [])])
def test_subscription_made_on_every_connection(monkeypatch, surface, expected):
    api = _api(monkeypatch, surface)
    client = FakeClient()
    ok = SimpleNamespace(is_failure=False)
    api.on_mqtt_connect(client, None, None, ok, None)
    api.on_mqtt_connect(client, None, None, ok, None)
    assert client.subscriptions == expected * 2


def test_refused_connection_subscribes_nothing(monkeypatch):
    api = _api(monkeypatch, "device")
    client = FakeClient()
    api.on_mqtt_connect(client, None, None, SimpleNamespace(is_failure=True), None)
    assert client.subscriptions == []
