"""Online-Dienste: die Opt-in-Zusage technisch festnageln.

Die Regel lautet: OHNE Zustimmung UND eingeschalteten Schalter geht KEIN einziger
Request nach außen. Das ist eine Zusage an den Nutzer, keine Komfortfunktion —
deshalb prüfen die ersten Tests hier nicht Rückgabewerte, sondern dass die
HTTP-Schicht überhaupt nicht angefasst wurde.

Dazu die Schema-Prüfung: heruntergeladene Inhalte bewegen im Zweifel Hardware
(Sequenzen), also fliegt alles raus, was nicht ins Schema passt."""
import asyncio
import json

import pytest

pytest.importorskip("httpx")

from app.services import online  # noqa: E402

CALLS = []          # jeder ausgehende Request landet hier


class FakeResponse:
    def __init__(self, payload, status=200):
        self._p, self.status_code = payload, status
        self.content = json.dumps(payload).encode()

    def json(self):
        return self._p


class FakeClient:
    payload = {}
    status = 200

    def __init__(self, **kw):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def get(self, url, params=None, headers=None):
        CALLS.append(url)
        return FakeResponse(FakeClient.payload, FakeClient.status)


class FakeHttpx:
    AsyncClient = FakeClient


@pytest.fixture(autouse=True)
def _isoliert(tmp_path, monkeypatch):
    """Eigener db-Ordner + Fake-HTTP je Test — kein echter Netzverkehr, keine
    Rückstände zwischen Tests."""
    monkeypatch.setattr(online, "DB_DIR", tmp_path)
    monkeypatch.setattr(online, "httpx", FakeHttpx)
    CALLS.clear()
    FakeClient.payload, FakeClient.status = {}, 200
    yield


def _fetch(*a, **kw):
    return asyncio.run(online.fetch(*a, **kw))


# ── Standard: alles aus ──────────────────────────────────────────────────────
def test_alles_standardmaessig_aus():
    cfg = online.read_settings()
    assert cfg["consented"] is False
    assert all(cfg[f] is False for f in online.FEATURES)
    assert cfg["server_url"] == "https://printloom.alexsz.de"
    assert not any(online.enabled(f) for f in online.FEATURES)


def test_ohne_freigabe_kein_request():
    FakeClient.payload = {"notices": [{"title": "X"}]}
    r = _fetch("api/v1/notices.json", "notices")
    assert CALLS == []                  # DAS ist die Zusage
    assert r["disabled"] is True and r["data"] is None


def test_schalter_ohne_zustimmung_bleibt_aus():
    online.write_settings({"notices": True})
    assert online.read_settings()["notices"] is False
    assert _fetch("api/v1/notices.json", "notices")["disabled"] is True
    assert CALLS == []


# ── Mit Zustimmung ───────────────────────────────────────────────────────────
def test_mit_zustimmung_geht_genau_ein_request_raus():
    online.write_settings({"consented": True, "notices": True})
    FakeClient.payload = {"notices": [{"id": "a", "title": "Bug", "severity": "warning"}]}
    r = _fetch("api/v1/notices.json", "notices")
    assert CALLS == ["https://printloom.alexsz.de/api/v1/notices.json"]
    assert r["ok"] and r["data"] == FakeClient.payload and r["from_cache"] is False


def test_zweiter_aufruf_kommt_aus_dem_cache():
    online.write_settings({"consented": True, "notices": True})
    FakeClient.payload = {"notices": []}
    _fetch("api/v1/notices.json", "notices")
    CALLS.clear()
    r = _fetch("api/v1/notices.json", "notices")
    assert CALLS == [] and r["from_cache"] is True


def test_force_umgeht_den_cache():
    online.write_settings({"consented": True, "notices": True})
    FakeClient.payload = {"notices": []}
    _fetch("api/v1/notices.json", "notices")
    CALLS.clear()
    _fetch("api/v1/notices.json", "notices", force=True)
    assert len(CALLS) == 1


def test_serverfehler_ist_nie_fatal():
    """Kein Netz / kaputter Server darf keine Fehlerwand ergeben — der letzte
    Stand bleibt sichtbar."""
    online.write_settings({"consented": True, "notices": True})
    FakeClient.payload = {"notices": [{"title": "alt"}]}
    _fetch("api/v1/notices.json", "notices")
    FakeClient.status = 500
    r = _fetch("api/v1/notices.json", "notices", force=True)
    assert r["error"] is not None
    assert r["data"] == {"notices": [{"title": "alt"}]}


def test_zustimmung_zurueckziehen_schaltet_alles_aus():
    online.write_settings({"consented": True, "notices": True, "library": True,
                           "update_check": True})
    cfg = online.write_settings({"consented": False})
    assert not any(cfg[f] for f in online.FEATURES)
    CALLS.clear()
    _fetch("api/v1/notices.json", "notices")
    assert CALLS == []


# ── Schema: Hinweise ─────────────────────────────────────────────────────────
RAW_NOTICES = {"notices": [
    {"id": "1", "title": "Gilt für alle", "severity": "critical", "text": "t"},
    {"id": "2", "title": "Nur 1.0.158", "versions": ["1.0.158"]},
    {"id": "3", "title": "Nur 1.0.99", "versions": ["1.0.99"]},
    {"title": "", "text": "ohne Titel"},
    {"id": "5", "title": "Böse URL", "url": "javascript:alert(1)"},
    "kein dict",
]}


def test_hinweise_werden_gefiltert():
    n = online.clean_notices(RAW_NOTICES, "1.0.158")
    ids = [x["id"] for x in n]
    assert len(n) == 3                       # titellos, Nicht-dict, fremde Version raus
    assert "1" in ids and "2" in ids and "3" not in ids
    assert all(x["title"] for x in n)


def test_nicht_http_url_wird_entfernt():
    n = online.clean_notices(RAW_NOTICES, "1.0.158")
    assert next(x for x in n if x["id"] == "5")["url"] == ""


def test_severity_wird_normalisiert():
    assert online.clean_notices({"notices": [{"title": "t", "severity": "boom"}]})[0]["severity"] == "info"
    assert online.clean_notices(RAW_NOTICES)[0]["severity"] == "critical"


def test_hinweise_robust_gegen_muell():
    assert online.clean_notices("quatsch") == []
    assert online.clean_notices(None) == []
    assert len(online.clean_notices([{"title": "direkt"}])) == 1
    assert len(online.clean_notices({"notices": [{"title": "x" * 999}]})[0]["title"]) <= 200


# ── Schema: Bibliothek ───────────────────────────────────────────────────────
def test_bibliothek_index_filtert_gefaehrliche_pfade():
    items = online.clean_library({"items": [
        {"id": "de", "kind": "language", "name": "Deutsch", "path": "lang/de.json"},
        {"id": "p1", "kind": "profile", "name": "X1C", "path": "profiles/p1.json"},
        {"id": "s1", "kind": "sequence", "name": "Standard", "path": "seq/s1.json"},
        {"id": "bad", "kind": "malware", "name": "n", "path": "x.json"},
        {"id": "trav", "kind": "profile", "name": "n", "path": "../../etc/passwd"},
        {"id": "abs", "kind": "profile", "name": "n", "path": "https://evil.tld/x.json"},
        {"id": "", "kind": "profile", "name": "n", "path": "p.json"},
    ]})
    assert {i["id"] for i in items} == {"de", "p1", "s1"}


def test_sprachpaket_inhalt():
    li = online.clean_library_item("language", {"code": "fr", "name": "Français",
                                                "strings": {"Ja": "Oui"}})
    assert li["code"] == "fr" and li["strings"] == {"Ja": "Oui"}


@pytest.mark.parametrize("bad", [{"code": "fr"}, {"strings": {"a": "b"}}, "kein dict"])
def test_kaputtes_sprachpaket_wirft(bad):
    with pytest.raises(ValueError):
        online.clean_library_item("language", bad)


def test_sequenz_inhalt():
    seq = online.clean_library_item("sequence", {"name": "S",
                                                 "steps": [{"type": "macro", "value": "X"}]})
    assert len(seq["steps"]) == 1


@pytest.mark.parametrize("bad", [{"steps": []}, {"steps": [{"novalue": 1}]}, {}])
def test_kaputte_sequenz_wirft(bad):
    """Sequenzen bewegen Hardware — ein Schritt ohne type darf nie durchgehen."""
    with pytest.raises(ValueError):
        online.clean_library_item("sequence", bad)


def test_unbekannte_art_wirft():
    with pytest.raises(ValueError):
        online.clean_library_item("unbekannt", {})
