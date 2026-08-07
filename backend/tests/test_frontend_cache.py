"""Cache-Regeln fürs ausgelieferte Frontend — die Ursache der Update-Schleife.

Vite hängt an jeden Asset-Namen einen Hash über den INHALT. Damit gilt:

  * assets/*  — kann sich unter demselben Namen nie ändern → lange cachen.
  * index.html — darin STEHEN die gehashten Namen. Liegt sie im Browser-Cache,
    lädt der Browser nach einem Update weiter das ALTE Frontend, während der
    Server bereits die neue Version meldet. Die App lädt daraufhin neu, bekommt
    wieder die alte index.html, lädt wieder neu … Endlosschleife.

Deshalb: index.html NIE zwischenspeichern.
"""
import pytest

pytest.importorskip("fastapi")

from fastapi.testclient import TestClient    # noqa: E402

from app import paths                        # noqa: E402
from app.main import app                     # noqa: E402


@pytest.fixture
def client():
    return TestClient(app)


def _frontend_gebaut() -> bool:
    return (paths.frontend_dir() / "index.html").is_file()


needs_build = pytest.mark.skipif(not _frontend_gebaut(),
                                 reason="frontend/dist nicht gebaut")


@needs_build
@pytest.mark.parametrize("pfad", ["/", "/dashboard", "/drucker", "/irgendein/tiefer/pfad"])
def test_index_html_wird_nie_zwischengespeichert(client, pfad):
    """Gilt für die Wurzel UND für den SPA-Fallback — es ist dieselbe Datei, und
    über den Fallback kommt der Nutzer nach einem Lesezeichen-Aufruf herein."""
    r = client.get(pfad)
    assert r.status_code == 200
    assert "no-store" in r.headers.get("cache-control", "").lower(), (
        f"{pfad} darf nicht gecacht werden — sonst zeigt der Browser nach einem "
        f"Update weiter das alte Frontend und die App lädt in einer Schleife neu.")


@needs_build
def test_gehashte_assets_duerfen_lange_liegen_bleiben(client):
    import glob
    import os.path
    treffer = glob.glob(str(paths.frontend_dir() / "assets" / "index-*.js"))
    if not treffer:
        pytest.skip("kein gehashtes Asset im Build gefunden")
    r = client.get(f"/assets/{os.path.basename(treffer[0])}")
    assert r.status_code == 200
    cc = r.headers.get("cache-control", "").lower()
    assert "immutable" in cc and "max-age=" in cc
    assert "no-store" not in cc


@needs_build
def test_service_worker_ist_kein_html(client):
    """sw.js muss mit echtem Inhalt und JavaScript-Typ kommen. Fiele er in den
    SPA-Fallback, bekäme der Browser index.html als text/html — iOS lehnt die
    Registrierung dann mit „unsupported MIME type" ab."""
    r = client.get("/sw.js")
    assert r.status_code == 200
    assert "javascript" in r.headers.get("content-type", "").lower()
    assert "<!doctype html" not in r.text[:200].lower()
