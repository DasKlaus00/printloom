"""Update-Prüfung und Update-Auslösung.

Bis v1.1.38 zeigte der Beta-Kanal nur einen Digest („sha256:3f9a…"), und während
GitHub eine neue Version baute, hieß es „aktuell". Seit v1.1.39 steht die Version
als Label im Image. Den Watchtower-Rückfall gibt es nicht mehr: ohne Docker-Socket
kommt eine klare Anleitung statt eines Requests an einen Dienst, den keiner hat.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from fastapi import HTTPException  # noqa: E402

from app.routers import system  # noqa: E402

INDEX = {"manifests": [
    # Attestierung zuerst — so liefert buildx es tatsächlich aus.
    {"digest": "sha256:att", "platform": {"architecture": "unknown", "os": "unknown"}},
    {"digest": "sha256:amd", "platform": {"architecture": "amd64", "os": "linux"}},
    {"digest": "sha256:arm", "platform": {"architecture": "arm64", "os": "linux"}},
]}
PLATFORM = {"config": {"digest": "sha256:cfg"}}


class _Resp:
    def __init__(self, data):
        self._data = data

    def json(self):
        return self._data

    def raise_for_status(self):
        pass


class _Client:
    def __init__(self, labels):
        self.labels = labels
        self.urls = []

    async def get(self, url, headers=None):
        self.urls.append(url)
        if url.endswith("/manifests/sha256:amd"):
            return _Resp(PLATFORM)
        if url.endswith("/blobs/sha256:cfg"):
            return _Resp({"config": {"Labels": self.labels}})
        raise AssertionError(url)


def _version(labels, manifest=INDEX):
    client = _Client(labels)
    v = asyncio.run(system._image_version(client, "dasklaus00/printloom", {}, manifest))
    return v, client.urls


def test_version_kommt_aus_dem_label_der_ersten_echten_plattform():
    v, urls = _version({system.VERSION_LABEL: "1.1.40"})
    assert v == "1.1.40"
    assert not any("sha256:att" in u for u in urls)


def test_branch_name_im_label_ist_keine_version():
    """metadata-action schrieb bis v1.1.38 „beta" ins Versions-Label."""
    assert _version({system.VERSION_LABEL: "beta"})[0] is None


def test_altes_image_ohne_label():
    assert _version({})[0] is None


def test_einzelnes_manifest_ohne_index():
    assert _version({system.VERSION_LABEL: "v1.2.3"}, PLATFORM)[0] == "1.2.3"


def test_building_nur_wenn_der_branch_neuer_ist():
    assert system._building("1.1.41", "1.1.40") == "1.1.41"
    assert system._building("1.1.40", "1.1.40") is None
    assert system._building("1.1.41", None) is None     # unbekannt ist nicht „älter"
    assert system._building(None, "1.1.40") is None


def _beta(monkeypatch, remote, branch, local):
    async def image(tag):
        return remote

    async def branch_version(name):
        return branch

    monkeypatch.setattr(system, "_ghcr_image", image)
    monkeypatch.setattr(system, "_branch_version", branch_version)
    monkeypatch.setattr(system, "_running_beta_digest", lambda: local)
    return asyncio.run(system._check_beta("1.1.39"))


def test_beta_zeigt_die_version_statt_des_digests(monkeypatch):
    r = _beta(monkeypatch, {"digest": "sha256:" + "b" * 64, "version": "1.1.40"},
              "1.1.40", "sha256:" + "a" * 64)
    assert r["latest"] == "1.1.40"
    assert r["latest_version"] == "1.1.40"
    assert r["update_available"] is True
    assert r["building"] is None


def test_beta_meldet_den_laufenden_build(monkeypatch):
    digest = "sha256:" + "a" * 64
    r = _beta(monkeypatch, {"digest": digest, "version": "1.1.39"}, "1.1.40", digest)
    assert r["update_available"] is False
    assert r["building"] == "1.1.40"


def test_beta_ohne_socket_vergleicht_die_version(monkeypatch):
    r = _beta(monkeypatch, {"digest": "sha256:x", "version": "1.1.39"}, "1.1.39", None)
    assert r["update_available"] is False


def test_beta_altes_image_zeigt_weiter_den_digest(monkeypatch):
    r = _beta(monkeypatch, {"digest": "sha256:" + "c" * 64, "version": None}, "1.1.40", None)
    assert r["latest"].startswith("sha256:")
    assert r["update_available"] is True
    assert r["building"] is None


def test_update_ohne_docker_socket_sagt_was_zu_tun_ist(monkeypatch):
    from app.services import updater
    monkeypatch.setattr(system.paths, "RUNTIME", "docker")
    monkeypatch.setattr(updater, "docker_available", lambda: False)
    with pytest.raises(HTTPException) as e:
        asyncio.run(system.trigger_update(system.UpdateIn(channel="beta")))
    assert e.value.status_code == 501
    assert "docker compose pull" in e.value.detail


def test_kein_watchtower_mehr():
    assert not hasattr(system, "WATCHTOWER_URL")
    assert not hasattr(system, "WATCHTOWER_TOKEN")


# ── Kanal vom Server, Zurückstufen nur mit Bestätigung (seit v1.1.64) ───────────

@pytest.fixture
def docker_beta(monkeypatch):
    from app.routers import autofarm
    from app.services import updater
    monkeypatch.setattr(system.paths, "RUNTIME", "docker")
    monkeypatch.setattr(system, "_docker_available", lambda: True)
    monkeypatch.setattr(updater, "docker_available", lambda: True)
    monkeypatch.setattr(updater, "current_image", lambda name: "ghcr.io/dasklaus00/printloom:beta")
    monkeypatch.setattr(system, "_get_current_version", lambda: "1.1.64")
    monkeypatch.setitem(autofarm._farm, "running", False)
    monkeypatch.setitem(autofarm._stress, "running", False)
    monkeypatch.setattr(autofarm, "_stress_task", None)
    return updater


def test_update_kanal_kommt_vom_server(docker_beta, monkeypatch):
    gefragt = []

    async def inner(channel, force):
        gefragt.append(channel)
        return {"current": "1.1.64"}
    monkeypatch.setattr(system, "_version_info_inner", inner)
    r = asyncio.run(system.get_version())
    assert gefragt == ["beta"] and r["running_channel"] == "beta"


def test_zurueckstufen_braucht_bestaetigung(docker_beta, monkeypatch):
    gezogen = []

    async def check(current, channel):
        assert channel == "latest"
        return {"latest": "1.1.41"}               # stabil ist älter als die laufende Beta
    monkeypatch.setattr(system, "_version_check", check)
    monkeypatch.setattr(docker_beta, "pull_image", lambda img: gezogen.append(img) or (False, "gestoppt"))
    with pytest.raises(HTTPException) as e:
        asyncio.run(system.trigger_update(system.UpdateIn(channel="latest")))
    assert e.value.status_code == 409 and e.value.detail["error"] == "ZURUECKSTUFEN"
    assert e.value.detail["from"] == "1.1.64" and e.value.detail["to"] == "1.1.41" and gezogen == []
    with pytest.raises(HTTPException) as e:              # bestätigt → das Update läuft los
        asyncio.run(system.trigger_update(system.UpdateIn(channel="latest", confirm_downgrade=True)))
    assert e.value.status_code == 502 and gezogen == ["ghcr.io/dasklaus00/printloom:latest"]


def test_gleicher_kanal_fragt_nicht(docker_beta, monkeypatch):
    async def check(current, channel):
        raise AssertionError("darf nicht ins Netz")
    monkeypatch.setattr(system, "_version_check", check)
    monkeypatch.setattr(docker_beta, "pull_image", lambda img: (False, "gestoppt"))
    with pytest.raises(HTTPException) as e:
        asyncio.run(system.trigger_update(system.UpdateIn(channel="beta")))
    assert e.value.status_code == 502


def test_nativer_kanal_wird_gespeichert(tmp_path, monkeypatch):
    from app.services import appsettings
    monkeypatch.setattr(appsettings, "_channel_file", lambda: str(tmp_path / "update_channel.json"))
    monkeypatch.setattr(system.paths, "RUNTIME", "native")
    assert system._running_channel() == "latest"
    system._remember_channel("beta")
    assert system._running_channel() == "beta"
