"""Wächter: keine neuen stillen Fehler im Backend.

`except …: pass` verschluckt einen Fehler, ohne dass ihn je jemand sieht. Ein Teil
davon ist harmlos (Aufräumen beim Beenden), ein Teil hat echte Fehler versteckt.
Die vorhandenen werden nach und nach behandelt oder geloggt. Dieser Test sorgt dafür,
dass keine neuen dazukommen (CLAUDE.md: „Keine neuen stillen except Exception: pass").

BASELINE darf nur sinken, nie steigen. Wer einen stillen Block entfernt, senkt die
Zahl hier mit.
"""
import re
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"

# Stand 17.11.2026 (v1.1.48), gezählt mit silent_excepts() unten.
BASELINE = 64

_EXCEPT = re.compile(r"\s*except\b[^:]*:\s*(#.*)?$")
_EXCEPT_INLINE = re.compile(r"\s*except\b[^:]*:\s*pass\s*(#.*)?$")


def silent_excepts(root: Path = APP) -> list[str]:
    """Alle `except …:` mit nur `pass` dahinter (nächste Zeile oder dieselbe)."""
    found = []
    for path in sorted(root.rglob("*.py")):
        lines = path.read_text(encoding="utf-8").splitlines()
        for i, line in enumerate(lines):
            nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
            if _EXCEPT_INLINE.match(line) or (_EXCEPT.match(line) and nxt == "pass"):
                found.append(f"{path.relative_to(root.parent)}:{i + 1}")
    return found


def test_keine_neuen_stillen_excepts():
    found = silent_excepts()
    assert len(found) <= BASELINE, (
        f"{len(found)} stille `except: pass` (erlaubt: {BASELINE}). Den neuen Fehler "
        "behandeln oder loggen statt verschlucken. Alle Fundstellen:\n" + "\n".join(found))


def test_zaehlung_erkennt_einen_neuen_stillen_block(tmp_path):
    # Gegenprobe: Der Zähler findet beide Schreibweisen, ein geloggter Block zählt nicht.
    (tmp_path / "m.py").write_text(
        "try:\n    x()\nexcept Exception:\n    pass\n"
        "try:\n    y()\nexcept (OSError, ValueError): pass\n"
        "try:\n    z()\nexcept Exception as e:\n    log.warning(e)\n", encoding="utf-8")
    assert len(silent_excepts(tmp_path)) == 2
