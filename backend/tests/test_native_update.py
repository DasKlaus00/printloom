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


def _check_liefert(monkeypatch, url, name="Printloom-Setup-1.1.42.exe"):
    async def fake_check(current, channel="latest"):
        return {"current": current, "latest": "1.1.42", "update_available": True,
                "download_url": url, "asset_name": name, "error": None}
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
