"""Bambu Lab HMS (Health Management System) code decoding.

The printer reports problems in MQTT under print.hms as a list of
{"attr": <int>, "code": <int>} entries. We decode these into the canonical
hex code string and a severity level so the farm can pause + notify on
serious/fatal issues instead of running on blindly.

Severity decode follows the widely used community convention
(pybambu / ha-bambulab): the high 16 bits of `code` carry the level.
"""

HMS_SEVERITY = {1: "fatal", 2: "serious", 3: "common", 4: "info"}
HMS_SEVERITY_DE = {"fatal": "schwerwiegend", "serious": "ernst", "common": "normal", "info": "Info", "unknown": "unbekannt"}

# Bambu-Wiki-Seite je HMS-Code. Format bestätigt:
# https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/0700_7000_0002_0004
HMS_WIKI_BASE = "https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/"


def wiki_url(code_str: str) -> str:
    """Direktlink zur Bambu-Wiki-Seite des Codes (Unterstrich-Format)."""
    return HMS_WIKI_BASE + (code_str or "")


# Kuratierte deutsche Kurzbeschreibungen für häufige Codes (Quelle: Bambu-HMS-Wiki).
# Bewusst klein gehalten und nur verifizierte Codes — unbekannte fallen auf einen
# ehrlichen Hinweis + Wiki-Link zurück statt zu raten.
HMS_KNOWN: dict[str, str] = {
    "0700_7000_0002_0004": "Filament konnte nicht aus dem Hotend ins AMS zurückgezogen werden — Filament/Spule auf Verklemmung prüfen.",
    "0300_0D00_0001_0003": "Druckplatte evtl. nicht korrekt aufgelegt — Platte prüfen und neu auflegen.",
}

# Codes that carry a fatal/serious bit but are harmless for unattended printing
# (typically AMS-side notices). These only notify, never pause the farm. The user
# can extend this list via farm settings (`hms_ignore`). Compared normalized, so
# any separator/case works: '0c00-0100-0001-0004' == '0C00_0100_0001_0004'.
HMS_SOFT_DEFAULT = {"0C00010000010004"}


def normalize_code(s: str) -> str:
    """Strip separators and case so codes compare regardless of formatting."""
    return "".join(ch for ch in (s or "") if ch.isalnum()).upper()


def code_str(attr: int, code: int) -> str:
    """Canonical Bambu HMS code, e.g. '0300_0100_0002_0001'."""
    return f"{attr >> 16:04X}_{attr & 0xFFFF:04X}_{code >> 16:04X}_{code & 0xFFFF:04X}"


def severity(code: int) -> str:
    lvl = (code >> 16) & 0xFFFF
    return HMS_SEVERITY.get(lvl, "unknown")


def describe(attr: int, code: int) -> tuple:
    """Return (code_str, severity, text). `text` ist die kuratierte Beschreibung
    oder ein ehrlicher Fallback — die genaue offizielle Beschreibung steht hinter
    wiki_url(code_str)."""
    cs = code_str(attr, code)
    sev = severity(code)
    text = HMS_KNOWN.get(cs) or "unbekannte Meldung — Details im Bambu-Wiki (Code antippen)"
    return cs, sev, text


def severe_entries(hms_list: list) -> list:
    """Decode HMS entries whose severity is fatal or serious.

    Returns list of (code_str, severity, text). Malformed entries are skipped.
    """
    out = []
    for entry in hms_list or []:
        try:
            attr = int(entry.get("attr", 0))
            code = int(entry.get("code", 0))
        except (AttributeError, TypeError, ValueError):
            continue
        cs, sev, text = describe(attr, code)
        if sev in ("fatal", "serious"):
            out.append((cs, sev, text))
    return out
