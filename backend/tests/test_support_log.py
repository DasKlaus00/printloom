"""Support-Log und Support-Bericht (seit v1.1.90).

Ein englisches Logfile zum Verschicken: Zeitstempel mit Zeitzone und Laufzeit, keine
Zugangsdaten, maskierte Adressen, Zustandswechsel der Drucker, Bedienungen und
Fehlerantworten, Abstürze mit Traceback — und ein Bericht, der das auswertet.
Der Wächter unten verbietet deutsche Texte in Log-Aufrufen.
"""
import ast
import asyncio
import copy
import logging
import re
import sys
import time
import types
from pathlib import Path

import pytest

pytest.importorskip("fastapi")

from app.routers import autofarm as af, control, system  # noqa: E402
from app.services import bambu_mqtt, printer_link, support_log, support_report  # noqa: E402
from app.services import ottoeject_motion as motion  # noqa: E402
from test_snapmaker_u1 import u1_status  # noqa: E402
from test_u1_farm import U1, X1C, moon  # noqa: E402,F401  (moon = Fixture)

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
DESKTOP = ROOT.parent / "desktop"


# ── Wächter: Log-Texte sind englisch ────────────────────────────────────────
LEVELS = {"debug", "info", "warning", "error", "exception", "critical", "log"}
GERMAN_CHARS = re.compile(r"[äöüÄÖÜß]")
GERMAN_WORDS = re.compile(
    r"\b(und|nicht|der|die|das|für|mit|wird|werden|ist|kein|keine|beim|nach|über|oder|noch|"
    r"schon|warte|fehlgeschlagen|gestartet|abgebrochen|gesendet|erreicht|Drucker|Datei|"
    r"Warteschlange|Regal|Fach|Platte|Gerät|Fehler|Fächer|Böden)\b")


def _is_log_call(node: ast.Call) -> bool:
    f = node.func
    if not isinstance(f, ast.Attribute) or f.attr not in LEVELS:
        return False
    v = f.value
    if isinstance(v, ast.Name) and ("log" in v.id.lower() or v.id == "logging"):
        return True
    return isinstance(v, ast.Call) and isinstance(v.func, ast.Attribute) and v.func.attr == "getLogger"


def _texts(node) -> list:
    """Alle Zeichenketten im Ausdruck — auch in Bedingungen wie 'level' if … else 'levels'."""
    return [n.value for n in ast.walk(node) if isinstance(n, ast.Constant) and isinstance(n.value, str)]


def _german(text: str) -> bool:
    return bool(GERMAN_CHARS.search(text) or GERMAN_WORDS.search(text))


def _sources():
    files = sorted(APP.rglob("*.py")) + sorted(DESKTOP.glob("*.py"))
    for p in files:
        yield p, ast.parse(p.read_text(encoding="utf-8"))


def test_log_texte_sind_englisch():
    funde = []
    for p, tree in _sources():
        for node in ast.walk(tree):
            if isinstance(node, ast.Call) and _is_log_call(node) and node.args:
                for t in _texts(node.args[0]):
                    if _german(t):
                        funde.append(f"{p.name}:{node.lineno}: {t[:80]!r}")
    assert not funde, "Deutsche Log-Texte (Support-Log ist englisch):\n" + "\n".join(funde)


def test_jede_farm_meldung_hat_eine_englische_fassung():
    tree = ast.parse((APP / "routers" / "autofarm.py").read_text(encoding="utf-8"))
    ohne, deutsch = [], []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_log":
            en = next((k.value for k in node.keywords if k.arg == "en"), None)
            if en is None:
                ohne.append(node.lineno)
                continue
            deutsch += [f"{node.lineno}: {t[:80]!r}" for t in _texts(en) if _german(t)]
    assert not ohne, f"_log ohne en= in Zeile {ohne}"
    assert not deutsch, "Deutsch in en=:\n" + "\n".join(deutsch)


def test_waechter_erkennt_deutsch():
    assert _german("Drucker nicht erreichbar") and _german("Größe")
    assert not _german("Printer not reachable (5/5) — retry…")


# ── Format und Datenschutz ──────────────────────────────────────────────────
def _record(msg, level=logging.INFO, name="app.services.printer_link", exc=None, fields=None):
    r = logging.LogRecord(name, level, __file__, 1, msg, None, exc)
    r.threadName = "MainThread"
    if fields:
        r.fields = fields
    return r


def test_zeile_mit_zeitzone_laufzeit_stufe_bereich():
    line = support_log.SupportFormatter().format(_record("Printer U1: initial state", fields={"a": 1}))
    m = support_log.LINE.match(line)
    assert m, line
    ts, up, level, comp, thread, msg = m.groups()
    assert re.fullmatch(r"\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} [+-]\d\d:\d\d", ts)
    assert float(up) >= 0 and level == "INFO" and comp == "printer_link"
    assert thread == "MainThread" and msg == "Printer U1: initial state | a=1"


def test_traceback_eingerueckt_und_bereinigt():
    try:
        raise RuntimeError("http://user:geheim@192.168.1.57/x?token=abc failed")
    except RuntimeError:
        rec = _record("boom", logging.ERROR, exc=sys.exc_info())
    text = support_log.SupportFormatter().format(rec)
    lines = text.splitlines()
    assert lines[1].startswith(support_log.TB_PREFIX + "Traceback")
    assert "geheim" not in text and "abc" not in text and "192.168.1.57" not in text
    assert "192.168.1.x" in text


def test_seriennummer_und_access_code_nie_im_log():
    support_log.hide("01P00A123456789", "serial")
    support_log.hide("87654321", "secret")
    s = support_log.clean("topic device/01P00A123456789/report code 87654321 ok")
    assert "01P00A123456789" not in s and "87654321" not in s
    assert "<serial …6789>" in s and "<secret>" in s
    assert support_log.clean(str(Path.home()) + "/x") == "~/x"


def test_logfile_entsteht_im_datenordner():
    assert support_log.install()
    assert support_log.install()                          # mehrfach aufrufbar
    logging.getLogger("printloom.test").warning("hello from the test")
    text = support_log.read_tail(200_000)
    assert support_log.log_path().parent == Path(support_log.paths.DATA_ROOT) / "logs"
    assert "=== Printloom " in text and "hello from the test" in text


# ── Zustandswechsel ─────────────────────────────────────────────────────────
def test_nur_wechsel_werden_geloggt(caplog):
    caplog.set_level(logging.INFO)
    key = ("test", time.time())
    assert support_log.state_change("printer.test", key, "P", {"s": "IDLE", "e": None})
    assert not support_log.state_change("printer.test", key, "P", {"s": "IDLE", "e": None})
    assert support_log.state_change("printer.test", key, "P", {"s": "RUNNING", "e": None})
    msgs = [r.getMessage() for r in caplog.records if r.name == "printloom.printer.test"]
    assert msgs == ["P: initial state s='IDLE'", "P: s 'IDLE' → 'RUNNING'"]


def test_bambu_zustand_mit_fehlercode_hexadezimal(caplog):
    caplog.set_level(logging.INFO)
    support_log.forget_state(("bambu", 2))
    fake = types.SimpleNamespace(device=X1C(), last_message={"print": {
        "gcode_state": "IDLE", "mc_print_stage": "1", "print_error": 0, "hms": []}})
    bambu_mqtt.BambuLabMQTT._log_state(fake)
    fake.last_message["print"].update(gcode_state="FAILED", print_error=0x0300800A,
                                      hms=[{"attr": 0x03000100, "code": 0x00010004}])
    bambu_mqtt.BambuLabMQTT._log_state(fake)
    bambu_mqtt.BambuLabMQTT._log_state(fake)              # keine Änderung → keine Zeile
    msgs = [r.getMessage() for r in caplog.records if r.name == "printloom.printer.bambu"]
    assert len(msgs) == 2 and "initial state gcode_state='IDLE'" in msgs[0]
    assert "gcode_state 'IDLE' → 'FAILED'" in msgs[1] and "0x0300800A" in msgs[1]
    assert "0300_0100_0001_0004" in msgs[1]


def test_u1_erreichbarkeit_nur_beim_wechsel(moon, caplog):
    caplog.set_level(logging.INFO)
    import httpx
    d = U1()
    support_log.forget_state(("moon-link", d.id))
    support_log.forget_state(("moon-state", d.id))
    assert printer_link.ensure(d)
    moon["fail"] = httpx.ConnectError("weg")
    for _ in range(3):
        assert not printer_link.ensure(d)
    moon["fail"] = None
    moon["status"] = u1_status("printing")
    moon["status"]["idle_timeout"] = {"state": "Printing"}
    assert printer_link.ensure(d)
    msgs = [r.getMessage() for r in caplog.records if r.name == "printloom.printer.moonraker"]
    assert sum("reachable True → False" in m for m in msgs) == 1          # nicht 3×
    assert sum("reachable False → True" in m for m in msgs) == 1
    assert any("print_state 'standby' → 'printing'" in m for m in msgs)
    warn = [r for r in caplog.records if "reachable True → False" in r.getMessage()]
    assert warn[0].levelno == logging.WARNING


# ── Farm-Log zweisprachig ───────────────────────────────────────────────────
def test_farm_log_deutsch_in_der_oberflaeche_englisch_im_logfile(monkeypatch, caplog):
    caplog.set_level(logging.INFO)
    monkeypatch.setitem(af._farm, "log", [])
    monkeypatch.setitem(af._farm, "log_en", [])
    af._log("📦 Regal voll", en="📦 Rack full")
    assert af._farm["log"][0].endswith("— 📦 Regal voll")
    assert af._farm["log_en"][0].endswith("— 📦 Rack full")
    assert [r.getMessage() for r in caplog.records if r.name == "printloom.farm"] == ["📦 Rack full"]


# ── Anfragen ────────────────────────────────────────────────────────────────
def test_anfragen_bedienung_fehler_langsam():
    from app import main
    main._req_seen.clear()
    assert main.request_log_line("GET", "/api/autofarm/status", 200, 0.01, 0) is None
    lvl, line = main.request_log_line("POST", "/api/autofarm/start", 409, 0.035, 0)
    assert lvl == logging.INFO and line == "POST /api/autofarm/start → 409 (35 ms)"
    assert main.request_log_line("GET", "/api/x", 500, 0.1, 0)[0] == logging.WARNING
    assert main.request_log_line("GET", "/api/printer/camera/3", 200, 3600, 0) is None
    assert main.request_log_line("GET", "/api/slow", 200, 6.0, 0) is not None


def test_wiederholte_fehlerantwort_hoechstens_einmal_je_minute():
    from app import main
    main._req_seen.clear()
    assert main.request_log_line("GET", "/api/p/1", 404, 0.01, 100.0)
    assert main.request_log_line("GET", "/api/p/1", 404, 0.01, 110.0) is None
    assert main.request_log_line("GET", "/api/p/1", 404, 0.01, 120.0) is None
    _, line = main.request_log_line("GET", "/api/p/1", 404, 0.01, 200.0)
    assert "(+2 identical" in line


# ── Auswertung ──────────────────────────────────────────────────────────────
def _log_text(records) -> str:
    f = support_log.SupportFormatter()
    return "\n".join(f.format(r) for r in records)


def test_auswertung_gruppiert_fehler_mit_erstem_und_letztem_auftreten():
    try:
        raise KeyError("slot")
    except KeyError:
        exc = sys.exc_info()
    recs = [_record(support_log.session_header(), name="printloom.app"),
            _record("Printer not reachable (1/5)…", logging.WARNING),
            _record("Printer not reachable (2/5)…", logging.WARNING),
            _record("POST /api/autofarm/start → unhandled exception after 12 ms", logging.ERROR,
                    name="printloom.api", exc=exc),
            _record("all good")]
    entries = support_log.parse(_log_text(recs))
    assert len(entries) == 5 and entries[3]["tb"]
    a = support_log.analyze(entries)
    assert a["levels"] == {"INFO": 2, "WARNING": 2, "ERROR": 1}
    assert len(a["starts"]) == 1
    g = a["groups"]
    assert g[0]["level"] == "ERROR" and g[0]["exception"].startswith("KeyError")
    warn = next(x for x in g if x["level"] == "WARNING")
    assert warn["count"] == 2 and warn["first"] <= warn["last"]


# ── Bericht ─────────────────────────────────────────────────────────────────
class _Dev:
    def __init__(self, **kw):
        self.__dict__.update(dict(use_tls=True, mqtt_port=8883, is_active=True, access_code="",
                                  serial_number=None), **kw)


class _DB:
    def __init__(self, devices):
        self.devices = devices

    def query(self, *a):
        return self

    def order_by(self, *a):
        return self

    def all(self):
        return self.devices


MOON_PROBE = {
    "printer_info": {"ok": True, "ms": 12, "result": {
        "state": "ready", "state_message": "Printer is ready", "hostname": "u1",
        "software_version": "v0.12.0-123-gabcdef", "cpu_info": "4 core ARMv8"}},
    "server_info": {"ok": True, "ms": 9, "result": {
        "klippy_connected": True, "klippy_state": "ready", "moonraker_version": "v0.9.3",
        "api_version_string": "1.5.0", "components": ["webcam", "file_manager"],
        "failed_components": [], "warnings": []}},
    "objects": {"ok": True, "ms": 8, "result": {"objects": ["webhooks", "print_stats", "extruder"]}},
    "webcams": {"ok": True, "ms": 7, "result": {"webcams": [{
        "name": "cam", "service": "mjpegstreamer", "enabled": True, "location": "printer",
        "stream_url": "http://192.168.7.21/webcam/?action=stream",
        "snapshot_url": "/webcam/?action=snapshot"}]}},
    "query": {"ok": True, "ms": 6, "result": {"status": {"webhooks": {"state": "ready"}}}},
}


def test_bericht_mit_befunden_steckbrief_und_ohne_geheimnisse(monkeypatch):
    u1 = _Dev(id=31, name="U1", model="u1", device_type=U1.device_type, ip_address="192.168.7.21",
              port=7125, access_code="geheimer-api-key")
    monkeypatch.setattr(af, "farm_printer_id", lambda: 31)
    monkeypatch.setattr(af, "farm_device", lambda db, bambu_only=False: u1)
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: copy.deepcopy(motion.DEFAULT_GEOMETRY))
    monkeypatch.setattr(control, "notaus_aktiv", lambda db: False)

    async def probe(base, hdr):
        return MOON_PROBE
    monkeypatch.setattr(support_report, "_probe_moonraker", probe)
    text = asyncio.run(support_report.build(_DB([u1]), "1.1.90"))

    assert text.startswith("PRINTLOOM SUPPORT REPORT")
    for part in ("1. FINDINGS", "2. PROBLEMS IN THE LOG", "ENVIRONMENT", "DEVICES (1)", "FARM", "LOG (newest last"):
        assert part in text, part
    assert "No OTTOeject (Klipper) configured" in text
    assert "positions not confirmed" in text                 # U1 ohne Bestätigung
    assert "klipper objects (3): webhooks, print_stats, extruder" in text
    assert "moonraker version: v0.9.3" in text and "FARM PRINTER" in text
    assert "192.168.7.21" not in text and "192.168.7.x" in text
    assert "geheimer-api-key" not in text


def test_bericht_meldet_unerreichbaren_drucker(monkeypatch):
    u1 = _Dev(id=31, name="U1", model="u1", device_type=U1.device_type, ip_address="10.0.0.9", port=7125)
    monkeypatch.setattr(af, "farm_printer_id", lambda: 31)
    monkeypatch.setattr(af, "farm_device", lambda db, bambu_only=False: u1)
    monkeypatch.setattr(af, "_load_farm_geometry", lambda: copy.deepcopy(motion.DEFAULT_GEOMETRY))
    monkeypatch.setattr(control, "notaus_aktiv", lambda db: True)

    async def probe(base, hdr):
        down = {"ok": False, "ms": 4000, "error": "ConnectTimeout: timed out"}
        return {k: down for k in MOON_PROBE}
    monkeypatch.setattr(support_report, "_probe_moonraker", probe)
    text = asyncio.run(support_report.build(_DB([u1]), "1.1.90"))
    assert "[ERROR  ] Printer 'U1' not reachable: ConnectTimeout: timed out" in text
    assert "Emergency stop is active" in text


def test_endpunkt_liefert_textdatei(monkeypatch):
    async def build(db, version):
        return "PRINTLOOM SUPPORT REPORT\n"
    monkeypatch.setattr(support_report, "build", build)
    r = asyncio.run(system.support_report())
    assert r.media_type.startswith("text/plain")
    assert 'filename="printloom-support-' in r.headers["content-disposition"]
    assert r.body.decode() == "PRINTLOOM SUPPORT REPORT\n"


def test_langsame_abfrage_hoechstens_einmal_je_minute():
    from app import main
    main._req_seen.clear()
    assert main.request_log_line("GET", "/api/system/health/targets", 200, 5.03, 10.0)
    assert main.request_log_line("GET", "/api/system/health/targets", 200, 5.03, 40.0) is None


def test_fehlertext_ohne_leeren_doppelpunkt():
    import httpx
    assert support_log.exc_text(httpx.ConnectTimeout("")) == "ConnectTimeout"
    assert support_log.exc_text(httpx.ConnectError("weg")) == "ConnectError: weg"
