"""Update der Windows-App: nur der Installer aus dem eigenen GitHub-Release.

Bis v1.1.41 nahm POST /api/system/update eine download_url aus dem Body und startete
die geladene Datei (os.startfile), dazu mit GITHUB_TOKEN an jeden Host. Zusammen
mit DNS-Rebinding konnte eine fremde Seite so jede .exe auf dem PC ausführen.
"""
import os
import tempfile
from pathlib import Path

import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.routers import system  # noqa: E402
from app.services import native_update  # noqa: E402

client = TestClient(app)
REPO = native_update.GITHUB_REPO
GOOD_URL = f"https://github.com/{REPO}/releases/download/v1.1.42/Printloom-Setup-1.1.42.exe"


class _FakeStream:
    """Ersatz für httpx.stream: schreibt mit, was geladen werden sollte."""
    calls: list = []

    def __init__(self, method, url, **kw):
        _FakeStream.calls.append({"url": url, **kw})

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def raise_for_status(self):
        pass

    def iter_bytes(self, chunk_size=0):
        yield b"MZ-installer"


@pytest.fixture
def geladen(monkeypatch):
    """httpx.stream und der Installer-Start gefälscht; gibt die Mitschrift zurück."""
    _FakeStream.calls = []
    started = []
    monkeypatch.setattr(native_update.httpx, "stream", _FakeStream)
    monkeypatch.setattr(native_update, "_launch_installer", lambda p: started.append(Path(p)))
    if os.name != "nt":
        monkeypatch.setattr(native_update.sys, "platform", "win32")
    return {"downloads": _FakeStream.calls, "started": started}


@pytest.mark.parametrize("url", [
    "https://angreifer.example/Printloom-Setup-1.1.42.exe",
    f"http://github.com/{REPO}/releases/download/v1/Printloom-Setup-1.1.42.exe",
    "https://github.com/someone/else/releases/download/v1/Printloom-Setup-1.1.42.exe",
    f"https://github.com.evil.example/{REPO}/releases/download/v1/Printloom-Setup-1.1.42.exe",
    f"https://github.com/{REPO}/archive/Printloom-Setup-1.1.42.exe",
    f"https://github.com/{REPO}/releases/download/../../../evil/repo/releases/download/v1/Printloom-Setup-1.1.42.exe",
    f"https://github.com/{REPO}/releases/download/v1.1.42/x/Printloom-Setup-1.1.42.exe",
    f"https://github.com:8443/{REPO}/releases/download/v1.1.42/Printloom-Setup-1.1.42.exe",
    f"https://github.com/{REPO}/releases/download/v1.1.42/Printloom-Setup-1.1.42.exe?x=1",
    "",
])
def test_nur_urls_aus_dem_eigenen_release(url, geladen):
    with pytest.raises(ValueError):
        native_update.download_and_launch(url, "Printloom-Setup-1.1.42.exe")
    assert geladen["downloads"] == [] and geladen["started"] == []


@pytest.mark.parametrize("name", ["..\\..\\x.exe", "C:\\x.exe", "../x.exe", "evil.exe",
                                  "Printloom-Setup-1.1.42.exe.bat", "Printloom-Portable-1.1.42.exe"])
def test_asset_name_bleibt_im_temp_ordner(name, geladen):
    with pytest.raises(ValueError):
        native_update.download_and_launch(GOOD_URL, name)
    with pytest.raises(ValueError):
        native_update.download_and_launch(GOOD_URL.rsplit("/", 1)[0] + "/" + name.replace("\\", "%5C"))
    assert geladen["started"] == []


def test_installer_landet_in_eigenem_temp_ordner(geladen):
    res = native_update.download_and_launch(GOOD_URL, "Printloom-Setup-1.1.42.exe")
    target = geladen["started"][0]
    assert target.name == "Printloom-Setup-1.1.42.exe"
    assert target.parent.name.startswith("printloom-update-")
    assert Path(tempfile.gettempdir()) in target.parents
    assert target.read_bytes() == b"MZ-installer"
    assert res["installer"] == str(target)


def test_token_nur_an_github_api(geladen, monkeypatch):
    monkeypatch.setattr(native_update, "GITHUB_TOKEN", "ghp_geheim")
    native_update.download_and_launch(GOOD_URL, "Printloom-Setup-1.1.42.exe")
    (call,) = geladen["downloads"]
    assert "Authorization" not in (call.get("headers") or {})


def _check_liefert(monkeypatch, url, name="Printloom-Setup-1.1.42.exe", sha256=None):
    async def fake_check(current, channel="latest"):
        return {"current": current, "latest": "1.1.42", "update_available": True,
                "download_url": url, "asset_name": name, "error": None, "sha256": sha256}
    monkeypatch.setattr(native_update, "check", fake_check)
    monkeypatch.setattr(system.paths, "RUNTIME", "native")


def test_update_verweigert_fremde_download_url(monkeypatch, geladen):
    # Der Body nennt eine fremde Adresse; geladen wird die aus check().
    _check_liefert(monkeypatch, GOOD_URL)
    r = client.post("/api/system/update", json={"download_url": "https://angreifer.example/x.exe",
                                                "asset_name": "x.exe"})
    assert r.status_code == 200, r.text
    assert [c["url"] for c in geladen["downloads"]] == [GOOD_URL]
    assert geladen["started"][0].name == "Printloom-Setup-1.1.42.exe"


def test_fremde_url_aus_der_pruefung_ergibt_400(monkeypatch, geladen):
    _check_liefert(monkeypatch, "https://angreifer.example/Printloom-Setup-1.1.42.exe")
    r = client.post("/api/system/update", json={})
    assert r.status_code == 400
    assert geladen["downloads"] == [] and geladen["started"] == []


# ── Prüfsumme (seit v1.1.75) ────────────────────────────────────────────────
import asyncio  # noqa: E402
import hashlib  # noqa: E402

import httpx  # noqa: E402

INHALT_SHA = hashlib.sha256(b"MZ-installer").hexdigest()   # was _FakeStream liefert


def test_passende_pruefsumme_startet(geladen):
    native_update.download_and_launch(GOOD_URL, "Printloom-Setup-1.1.42.exe", INHALT_SHA)
    assert len(geladen["started"]) == 1


def test_falsche_pruefsumme_startet_nicht(geladen):
    with pytest.raises(ValueError, match="Prüfsumme"):
        native_update.download_and_launch(GOOD_URL, "Printloom-Setup-1.1.42.exe", "0" * 64)
    assert geladen["started"] == []


def test_falsche_pruefsumme_ueber_den_endpunkt_ergibt_400(monkeypatch, geladen):
    _check_liefert(monkeypatch, GOOD_URL, sha256="f" * 64)
    r = client.post("/api/system/update", json={})
    assert r.status_code == 400 and "Prüfsumme" in r.text
    assert geladen["started"] == []


def test_ohne_pruefsumme_startet_mit_warnung(geladen, caplog):
    native_update.download_and_launch(GOOD_URL, "Printloom-Setup-1.1.42.exe")
    assert len(geladen["started"]) == 1
    assert "ohne Prüfsumme" in caplog.text


def _release(assets):
    return [{"tag_name": "v1.1.42", "prerelease": False, "draft": False, "body": "",
             "assets": assets}]


def _mit_github(monkeypatch, releases, dateien=None):
    """api.github.com liefert `releases`; Dateien unter github.com aus `dateien`."""
    gesehen = []

    def handler(request):
        gesehen.append(str(request.url))
        if request.url.host == "api.github.com":
            return httpx.Response(200, json=releases)
        text = (dateien or {}).get(str(request.url))
        return httpx.Response(200, text=text) if text is not None else httpx.Response(404)
    echt = httpx.AsyncClient
    monkeypatch.setattr(native_update.httpx, "AsyncClient",
                        lambda **kw: echt(transport=httpx.MockTransport(handler), **kw))
    return gesehen


def test_check_nimmt_den_digest_von_github(monkeypatch):
    _mit_github(monkeypatch, _release([{
        "name": "Printloom-Setup-1.1.42.exe", "browser_download_url": GOOD_URL,
        "digest": "sha256:" + "AB" * 32}]))
    r = asyncio.run(native_update.check("1.1.41"))
    assert r["error"] is None and r["sha256"] == "ab" * 32


def test_check_liest_sonst_die_sha256_datei(monkeypatch):
    gesehen = _mit_github(monkeypatch, _release([
        {"name": "Printloom-Setup-1.1.42.exe", "browser_download_url": GOOD_URL},
        {"name": "Printloom-Setup-1.1.42.exe.sha256", "browser_download_url": GOOD_URL + ".sha256"},
    ]), {GOOD_URL + ".sha256": INHALT_SHA + "  Printloom-Setup-1.1.42.exe\n"})
    r = asyncio.run(native_update.check("1.1.41"))
    assert r["sha256"] == INHALT_SHA
    assert GOOD_URL + ".sha256" in gesehen


def test_sha256_datei_von_anderer_adresse_wird_nicht_gelesen(monkeypatch):
    fremd = "https://angreifer.example/x.sha256"
    gesehen = _mit_github(monkeypatch, _release([
        {"name": "Printloom-Setup-1.1.42.exe", "browser_download_url": GOOD_URL},
        {"name": "Printloom-Setup-1.1.42.exe.sha256", "browser_download_url": fremd},
    ]), {fremd: INHALT_SHA})
    r = asyncio.run(native_update.check("1.1.41"))
    assert r["sha256"] is None
    assert fremd not in gesehen
