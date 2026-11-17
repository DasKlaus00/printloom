"""Wächter: Jedes Paket in requirements.txt wird auch benutzt (seit v1.1.76).

Bis v1.1.75 standen dort vier Pakete, die nirgends importiert wurden
(pydantic-settings, aiofiles, python-dotenv und `cors` — ein Sicherheits-Scanner,
kein CORS-Modul). Jedes davon wurde in jedes Image und jede Windows-App gepackt
und vergrößerte die Angriffsfläche ohne Nutzen.
"""
import re
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
APP = BACKEND / "app"

# Paketname → importierter Modulname, wo sie sich unterscheiden
MODULE = {"paho-mqtt": "paho", "python-multipart": "multipart"}

# Werden gebraucht, ohne dass die App sie selbst importiert — mit Grund:
OHNE_IMPORT = {
    "websockets": "WebSocket-Unterstützung für uvicorn (/api/autofarm/ws)",
    "python-multipart": "FastAPI braucht es für Datei-Uploads (Form/UploadFile)",
    "tzdata": "reine Zeitzonen-Daten für zoneinfo (slim-Image ohne System-tzdata)",
}


def _packages() -> list[str]:
    out = []
    for line in (BACKEND / "requirements.txt").read_text(encoding="utf-8").splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            out.append(re.split(r"[<>=!~\[ ;]", line, maxsplit=1)[0].strip().lower())
    return out


def _imported() -> set[str]:
    found = set()
    rx = re.compile(r"^\s*(?:from|import)\s+([A-Za-z_][\w]*)", re.M)
    for path in APP.rglob("*.py"):
        found.update(rx.findall(path.read_text(encoding="utf-8")))
    return found


def test_jedes_paket_wird_importiert():
    imported = _imported()
    unbenutzt = [p for p in _packages()
                 if p not in OHNE_IMPORT and MODULE.get(p, p.replace("-", "_")) not in imported]
    assert unbenutzt == [], f"In requirements.txt, aber nirgends importiert: {unbenutzt}"


def test_ausnahmen_stehen_auch_in_requirements():
    # Eine Ausnahme ohne Paket wäre eine tote Zeile in diesem Test.
    assert set(OHNE_IMPORT) <= set(_packages())


def test_die_alten_vier_sind_weg():
    assert not {"pydantic-settings", "aiofiles", "python-dotenv", "cors"} & set(_packages())
