"""Zeitstempel mit Zeitzone (seit v1.1.72).

Farm-Historie, Timeline, HMS-Liste, Recovery, Statistik und Sende-Diagnose schrieben
bis v1.1.71 `datetime.now().isoformat()`: Serverzeit OHNE Zone. Im Docker-Container
ist das meist UTC, der Browser liest einen Wert ohne Zone aber als SEINE Ortszeit —
die Historie lag im Sommer zwei Stunden daneben. In der Windows-App stimmte es nur,
weil Server und Browser auf demselben Rechner laufen.

Geschrieben wird jetzt UTC mit Offset (`now_iso`). Bestandseinträge ohne Offset
bekommen beim Lesen den Offset der SERVERZEIT (`as_aware_iso`). Das ist anders als
`printer._utc_marked`: Jene Einträge wurden mit utcnow() geschrieben, diese mit now().
"""
from datetime import datetime, timezone
from typing import Optional


def now_iso() -> str:
    """Jetzt als ISO-Zeit in UTC mit Offset, z. B. '2026-11-18T00:05:00+00:00'."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def aware_iso(dt: datetime) -> str:
    """datetime → ISO mit Offset. Ein naiver Wert gilt als Serverzeit (so rechnet der
    Farm-Zyklus intern); astimezone() hängt deren Offset an."""
    return (dt if dt.tzinfo else dt.astimezone()).isoformat(timespec="seconds")


def as_aware(ts) -> Optional[datetime]:
    """Gespeicherten Zeitstempel lesen. Ohne Offset = Serverzeit. Leer/kaputt → None."""
    if not ts:
        return None
    try:
        d = datetime.fromisoformat(str(ts))
    except ValueError:
        return None
    return d if d.tzinfo else d.astimezone()


def as_aware_iso(ts):
    """Gespeicherten Zeitstempel mit Offset zurückgeben; leer oder kaputt bleibt, wie
    er ist (die Anzeige zeigt dann den Rohtext statt einer erfundenen Zeit)."""
    d = as_aware(ts)
    return d.isoformat(timespec="seconds") if d else ts
