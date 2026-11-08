"""OrcaSlicer-Plugin „Printloom" (orca-plugin/printloom_orca.py).

Was Orca vom Geräte-Bericht erwartet, steht nicht in der Plugin-Doku, sondern in
Orcas eigenem Moonraker-Agenten. Die wichtigsten Stellen, an denen ein Fehler den
Druckknopf sperrt oder an Printloom vorbeiführt, sind hier festgehalten:
  • vollständiger Bericht (msg 0), Speicherkarte „normal" (sdcard + home_flag Bits 8–9)
  • kein „fun"/„ipcam": daran schaltet Orca Bambu-eigene Wege direkt zum Drucker ein
  • Antwort auf get_version — sonst bleibt der Druckdialog bei „Lese…"
  • die Probe „verify_job" lädt nichts hoch
Und: Befehle, die Hardware bewegen, sind „nicht unterstützt".
"""
import gzip
import json
import os
import threading
import time
import types

import pytest


def wait_for(cond, timeout=5.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    raise AssertionError("Bedingung nicht eingetreten")


def start(plugin, url="", **settings):
    tab, agent = plugin.PrintloomTab(), plugin.PrintloomAgent()
    tab.on_load()
    agent.on_load()
    if url or settings:
        plugin.CORE.settings.update({"url": url, **settings})
    return tab, agent


# ── Registrierung ───────────────────────────────────────────────────────────────

def test_registriert_tab_und_agent_und_bittet_nur_um_threads(plugin):
    plugin.PrintloomPlugin().register_capabilities()
    assert plugin.orca_fake.registered == [plugin.PrintloomTab, plugin.PrintloomAgent]
    assert plugin.orca_fake.permissions == {"threading": True}


def test_agent_id_bleibt_stabil(plugin):
    """Die ID steht in den Drucker-Profilen der Nutzer."""
    info = plugin.PrintloomAgent().get_agent_info()
    assert info.id == "printloom"
    assert info.id not in ("orca", "bbl", "qidi", "snapmaker", "crealityprint", "moonraker")


# ── Geräte-Bericht ──────────────────────────────────────────────────────────────

def test_bericht_hat_was_orca_zum_drucken_braucht(plugin):
    state = {"print": {"gcode_state": "RUNNING", "mc_percent": 42, "nozzle_temper": 220,
                       "ams": {"ams": [{"id": "0"}]}, "fun": "3EC1AFFF9CFF",
                       "ipcam": {"rtsp_url": "rtsps://x"}}}
    p = plugin.build_status_payload(state, 1234)
    body = p["print"]
    assert body["command"] == "push_status" and body["msg"] == 0
    assert body["sdcard"] is True and body["home_flag"] == 1 << 8
    assert body["support_send_to_sd"] is True
    assert body["gcode_state"] == "RUNNING" and body["mc_print_stage"] == 1
    assert body["mc_percent"] == 42 and body["ams"] == {"ams": [{"id": "0"}]}
    assert body["print_error"] == 0 and body["mc_print_error_code"] == 0
    assert "fun" not in body and "ipcam" not in body
    assert p["t_utc"] == 1234


def test_ohne_druckerdaten_meldet_der_bericht_leerlauf(plugin):
    body = plugin.build_status_payload({}, 0)["print"]
    assert body["gcode_state"] == "IDLE" and body["mc_print_stage"] == 0


def test_versionsantwort(plugin):
    r = plugin.version_reply("1.1.40")
    assert r["info"]["command"] == "get_version" and r["info"]["result"] == "success"
    assert r["info"]["module"][0]["name"] == "ota" and r["info"]["module"][0]["sw_ver"] == "1.1.40"


# ── kleine Helfer ───────────────────────────────────────────────────────────────

@pytest.mark.parametrize("url,dev", [
    ("http://192.168.1.20:8000/", "192.168.1.20:8000"),
    ("https://printloom.example.de", "printloom.example.de"),
    ("printloom.local:8000", "printloom.local:8000"),
    ("https://printloom.example.de/api/x", "printloom.example.de"),
])
def test_geraete_id_wie_orca_sie_aus_der_adresse_bildet(plugin, url, dev):
    assert plugin.device_id_for(url) == dev


@pytest.mark.parametrize("project,file,name", [
    ("Halter.gcode.3mf", "C:/tmp/x.3mf", "Halter.gcode.3mf"),
    ("Halter", "C:/tmp/x.3mf", "Halter.gcode.3mf"),
    ("Halter.3mf", "/tmp/plate.gcode", "Halter.gcode"),
    ("", "/tmp/Teil.gcode.3mf", "Teil.gcode.3mf"),
])
def test_dateiname_fuer_die_bibliothek(plugin, project, file, name):
    assert plugin.upload_name(project, file) == name


# ── Texte zum Farm-Check ────────────────────────────────────────────────────────

CRASH = {"crash_risk": True, "hit_x_mm": 5.0, "z_limit_mm": 30.0, "x_margin_mm": 10.0}


def test_warnung_kollision_und_zu_hoch(plugin):
    warnings, hints, _ = plugin.describe_checks("de", [{
        "plate": 2, "crash": CRASH,
        "height": {"ok": False, "height_mm": 300.0, "max_height_mm": 275.0},
        "spool": {"state": "ok", "items": []}}])
    assert warnings[0].startswith("Platte 2: Arm-Kollision")
    assert "X 5 mm" in warnings[0] and "Randstreifen 10 mm" in warnings[0]
    assert "300 mm (max. 275 mm)" in warnings[1]
    assert hints == []


def test_warnung_spule_und_fehlendes_material(plugin):
    warnings, _, _ = plugin.describe_checks("de", [{"crash": {}, "height": {"ok": True},
        "spool": {"state": "short", "items": [
            {"status": "short", "label": "A3", "type": "PLA", "left_g": 80.0, "need_g": 111.3},
            {"status": "no_material", "type": "PETG"}]}}])
    assert warnings == ["Fach A3 (PLA): noch ca. 80 g, der Druck braucht 111.3 g.",
                        "Kein PETG im AMS — die Farm würde pausieren."]


def test_alles_gut_mit_mehreren_faechern_als_hinweis(plugin):
    warnings, hints, summary = plugin.describe_checks("de", [{"crash": {"crash_risk": False},
        "height": {"ok": True, "slots_needed": 2, "height_mm": 80.0},
        "spool": {"state": "ok", "items": []}}])
    assert warnings == [] and hints == ["Belegt 2 Fächer (80 mm hoch)."]
    assert summary == "Printloom: Farm-Check ok — Arm frei, 2 Fächer, Spulen reichen."


def test_unbekannte_spule_ist_nicht_reicht(plugin):
    _, _, summary = plugin.describe_checks("en", [{"spool": {"state": "unknown"}}])
    assert "spools unknown" in summary


# ── Einstellungen ───────────────────────────────────────────────────────────────

def test_passwort_bleibt_bis_es_geloescht_wird(plugin, tmp_path):
    s = plugin.Settings(str(tmp_path))
    s.update({"url": "printloom.local:8000", "user": "alex", "password": "geheim"})
    assert s.data["url"] == "http://printloom.local:8000"
    s.update({"url": "printloom.local:8000", "password": ""})
    assert s.data["password"] == "geheim"
    assert "password" not in s.public() and s.public()["has_password"] is True
    s.update({"clear_password": True})
    assert s.data["password"] == ""
    again = plugin.Settings(str(tmp_path))
    again.load()
    assert again.data["user"] == "alex"


def test_einstellungen_liegen_nicht_unter_einem_conf_pfad(plugin, tmp_path):
    """Orca blockt für Plugins jeden Pfad mit „conf"/„secret"/„cert" darin."""
    path = plugin.Settings(str(tmp_path)).path.lower()
    assert not any(word in os.path.basename(path) for word in ("conf", "secret", "cert"))


# ── HTTP ────────────────────────────────────────────────────────────────────────

def test_basic_auth_hinter_authentik(plugin, printloom):
    plugin.Client(printloom.url, "alex", "app-pw").info()
    assert printloom.requests[-1]["auth"] == "Basic YWxleDphcHAtcHc="


def test_ohne_zugangsdaten_kein_auth_kopf(plugin, printloom):
    plugin.Client(printloom.url).info()
    assert printloom.requests[-1]["auth"] is None


def test_anmeldeseite_statt_api_wird_erkannt(plugin, printloom):
    printloom.html_login = True
    with pytest.raises(plugin.PrintloomError, match="Anmeldeseite"):
        plugin.Client(printloom.url).info()


def test_falsche_api_version(plugin, printloom):
    printloom.info["api"] = 99
    with pytest.raises(plugin.PrintloomError, match="zu alt oder zu neu"):
        plugin.Client(printloom.url).info()


def test_nicht_erreichbar(plugin, monkeypatch):
    import urllib.error

    def refused(*a, **k):
        raise urllib.error.URLError(ConnectionRefusedError(10061, "Verbindung verweigert"))
    monkeypatch.setattr(plugin.urllib.request, "urlopen", refused)
    with pytest.raises(plugin.PrintloomError, match="verweigert"):
        plugin.Client("http://127.0.0.1:9").info()


def test_check_schickt_den_gcode_gepackt(plugin, printloom):
    plugin.Client(printloom.url).check_gcode(b"G1 X5 Z40\n" * 100)
    req = printloom.requests[-1]
    assert req["path"] == "/api/slicer/check" and req["body"] == b"G1 X5 Z40\n" * 100


def test_upload_mit_fortschritt(plugin, printloom, tmp_path):
    f = tmp_path / "x.gcode.3mf"
    f.write_bytes(b"x" * (3 * 1024 * 1024 + 5))
    progress = {}
    r = plugin.Client(printloom.url).upload(str(f), "Teil.gcode.3mf", True, progress,
                                            threading.Event())
    assert r["job_ids"] == [3]
    req = printloom.requests[-1]
    assert req["query"] == {"filename": "Teil.gcode.3mf", "queue": "true"}
    assert len(req["body"]) == f.stat().st_size
    assert progress["sent"] == progress["total"] == f.stat().st_size


# ── Agent: Befehle aus Orca ─────────────────────────────────────────────────────

def _agent_with_messages(plugin):
    agent = plugin.PrintloomAgent()
    msgs = []
    agent.set_on_local_message_fn(lambda dev, msg: msgs.append((dev, json.loads(msg))))
    return agent, msgs


def test_get_version_wird_beantwortet(plugin):
    agent, msgs = _agent_with_messages(plugin)
    assert agent.send_message_to_printer("pl", json.dumps({"info": {"command": "get_version"}}), 0, 0) == 0
    assert msgs[0][1]["info"]["command"] == "get_version"


def test_zugangscode_kommt_zurueck(plugin):
    agent, msgs = _agent_with_messages(plugin)
    agent.access_code = "88888888"
    agent.send_message_to_printer("pl", json.dumps({"system": {"command": "get_access_code"}}), 0, 0)
    assert msgs[0][1] == {"system": {"command": "get_access_code", "access_code": "88888888"}}


@pytest.mark.parametrize("cmd", [
    {"print": {"command": "gcode_line", "param": "G28"}},
    {"print": {"command": "set_bed_temp", "temp": 60}},
    {"system": {"command": "ledctrl"}},
])
def test_hardware_befehle_sind_nicht_unterstuetzt(plugin, cmd):
    agent, msgs = _agent_with_messages(plugin)
    assert agent.send_message_to_printer("pl", json.dumps(cmd), 0, 0) == plugin.NOT_SUPPORTED
    assert msgs == []


def test_binden_gibt_es_nicht(plugin):
    agent = plugin.PrintloomAgent()
    assert (agent.check_cert(), agent.ping_bind(""), agent.unbind("x")) == (0, 0, 0)
    assert agent.request_bind_ticket() == (0, "")
    assert agent.get_filament_sync_mode() == plugin.pa.FilamentSyncMode.Subscription


# ── Agent: Verbinden, Bericht, Senden ───────────────────────────────────────────

def test_verbinden_meldet_ok_version_und_zustand(plugin, printloom):
    _, agent = start(plugin, printloom.url)
    connects, msgs = [], []
    agent.set_on_local_connect_fn(lambda st, dev, m: connects.append((st, dev)))
    agent.set_on_local_message_fn(lambda dev, msg: msgs.append(json.loads(msg)))
    assert agent.connect_printer(types.SimpleNamespace(dev_id="127.0.0.1:1", password="")) == 0
    wait_for(lambda: any("print" in m for m in msgs))
    assert connects[0] == (0, "127.0.0.1:1")
    assert any(m.get("info", {}).get("command") == "get_version" for m in msgs)
    status = next(m for m in msgs if "print" in m)["print"]
    assert status["gcode_state"] == "RUNNING" and status["mc_percent"] == 42


def test_entdeckung_meldet_die_farm_mit_modellcode(plugin, printloom):
    _, agent = start(plugin, printloom.url)
    found = []
    agent.set_on_ssdp_msg_fn(lambda j: found.append(json.loads(j)))
    assert agent.start_discovery(True, False) is True
    wait_for(lambda: found)
    dev = found[0]
    assert dev["dev_id"] == plugin.device_id_for(printloom.url) == dev["dev_ip"]
    assert dev["dev_type"] == "BL-P001" and dev["connect_type"] == "lan"
    assert dev["bind_state"] == "free"


def test_probe_vor_dem_senden_laedt_nichts_hoch(plugin, printloom, tmp_path):
    _, agent = start(plugin, printloom.url)
    probe = tmp_path / "verify.gcode"
    probe.write_text("x")
    params = types.SimpleNamespace(project_name="verify_job", filename=str(probe))
    assert agent.start_send_gcode_to_sdcard(params, None, None, None) == 0
    assert not any(r["path"] == "/api/slicer/upload" for r in printloom.requests)


def test_senden_legt_in_die_warteschlange(plugin, printloom, tmp_path):
    _, agent = start(plugin, printloom.url)
    f = tmp_path / "plate.3mf"
    f.write_bytes(b"3mf" * 1000)
    stages = []
    params = types.SimpleNamespace(project_name="Halter.gcode.3mf", filename=str(f))
    rc = agent.start_send_gcode_to_sdcard(params, lambda s, c, m: stages.append(s), lambda: False, None)
    assert rc == 0
    up = next(r for r in printloom.requests if r["path"] == "/api/slicer/upload")
    assert up["query"] == {"filename": "Halter.gcode.3mf", "queue": "true"}
    assert stages[0] == plugin.STAGE_CREATE and stages[-1] == plugin.STAGE_FINISHED
    note = plugin.orca_fake.notifications
    assert ("regular", "Printloom: „Halter.gcode.3mf“ in der Warteschlange (1 Job).") in note
    # Die Prüfung der echten Datei kommt gleich mit (hier: Kollisionszone).
    assert any(level == "warning" and "Arm-Kollision" in text for level, text in note)


def test_senden_nur_bibliothek_wenn_so_eingestellt(plugin, printloom, tmp_path):
    _, agent = start(plugin, printloom.url, send_queues=False)
    f = tmp_path / "p.3mf"
    f.write_bytes(b"x")
    params = types.SimpleNamespace(project_name="A", filename=str(f))
    assert agent.start_send_gcode_to_sdcard(params, None, None, None) == 0
    up = next(r for r in printloom.requests if r["path"] == "/api/slicer/upload")
    assert up["query"]["queue"] == "false"


def test_drucken_reiht_immer_ein(plugin, printloom, tmp_path):
    _, agent = start(plugin, printloom.url, send_queues=False)
    f = tmp_path / "p.3mf"
    f.write_bytes(b"x")
    params = types.SimpleNamespace(project_name="A", filename=str(f))
    assert agent.start_local_print(params, None, None) == 0
    up = next(r for r in printloom.requests if r["path"] == "/api/slicer/upload")
    assert up["query"]["queue"] == "true"


def test_abbrechen_beim_senden(plugin, printloom, tmp_path, monkeypatch):
    _, agent = start(plugin, printloom.url)
    gate = threading.Event()
    monkeypatch.setattr(plugin.Core, "send_file", lambda self, *a: gate.wait(5))
    f = tmp_path / "p.3mf"
    f.write_bytes(b"x")
    params = types.SimpleNamespace(project_name="A", filename=str(f))
    calls = {"n": 0}

    def cancel():
        calls["n"] += 1
        if calls["n"] > 2:
            gate.set()
            return True
        return False

    assert agent.start_local_print(params, None, cancel) == plugin.ERR_CANCELED


def test_ohne_adresse_wird_nicht_gesendet(plugin, tmp_path):
    _, agent = start(plugin)
    f = tmp_path / "p.3mf"
    f.write_bytes(b"x")
    params = types.SimpleNamespace(project_name="A", filename=str(f))
    assert agent.start_local_print(params, None, None) == plugin.ERR_CONNECT
    assert plugin.orca_fake.notifications[-1][0] == "warning"


def test_fehlende_datei(plugin, printloom):
    _, agent = start(plugin, printloom.url)
    params = types.SimpleNamespace(project_name="A", filename="C:/gibt/es/nicht.3mf")
    assert agent.start_local_print(params, None, None) == plugin.ERR_FILE


# ── Teil 1: Prüfen nach dem Slicen ──────────────────────────────────────────────

def _export_event(plugin, tab, path):
    ctx = types.SimpleNamespace(code=plugin.orca.LifecycleEvtCode.Ok, msg=str(path))
    tab.on_lifecycle_event(plugin.orca.LifecycleEvent.GCodeExportFinished, ctx)


def test_nach_dem_slicen_wird_geprueft_und_gewarnt(plugin, printloom, tmp_path):
    tab, _ = start(plugin, printloom.url)
    g = tmp_path / "plate_1.gcode"
    g.write_bytes(b"G1 Z40\nG1 X5\n")
    _export_event(plugin, tab, g)
    wait_for(lambda: plugin.orca_fake.notifications)
    req = next(r for r in printloom.requests if r["path"] == "/api/slicer/check")
    assert req["body"] == b"G1 Z40\nG1 X5\n"
    level, text = plugin.orca_fake.notifications[0]
    assert level == "warning" and "Arm-Kollision" in text


def test_dieselbe_datei_wird_nicht_doppelt_geprueft(plugin, printloom, tmp_path):
    tab, _ = start(plugin, printloom.url)
    g = tmp_path / "plate_1.gcode"
    g.write_text("G1 X50\n")
    _export_event(plugin, tab, g)
    wait_for(lambda: plugin.orca_fake.notifications)
    _export_event(plugin, tab, g)
    time.sleep(0.3)
    assert sum(1 for r in printloom.requests if r["path"] == "/api/slicer/check") == 1


def test_pruefen_laesst_sich_abschalten(plugin, printloom, tmp_path):
    tab, _ = start(plugin, printloom.url, check_after_slice=False)
    g = tmp_path / "plate_1.gcode"
    g.write_text("G1 X50\n")
    _export_event(plugin, tab, g)
    time.sleep(0.3)
    assert not any(r["path"] == "/api/slicer/check" for r in printloom.requests)


def test_nur_gcode_wird_geprueft(plugin, printloom, tmp_path):
    tab, _ = start(plugin, printloom.url)
    f = tmp_path / "projekt.3mf"
    f.write_text("x")
    _export_event(plugin, tab, f)
    time.sleep(0.3)
    assert not any(r["path"] == "/api/slicer/check" for r in printloom.requests)


# ── Teil 5: Tab ─────────────────────────────────────────────────────────────────

def test_tab_bekommt_zustand_ohne_passwort(plugin, printloom):
    tab, _ = start(plugin, printloom.url, user="alex", password="geheim")
    tab.on_message({"type": "ready"})
    wait_for(lambda: any(m.get("overview") for m in getattr(tab, "posted", [])))
    last = [m for m in tab.posted if m.get("overview")][-1]
    assert last["type"] == "state" and last["lang"] == "de"
    assert last["settings"]["has_password"] is True
    assert "geheim" not in json.dumps(tab.posted)
    assert last["texts"]["queue"] == "Warteschlange"


def test_speichern_aus_dem_tab_testet_die_verbindung(plugin, printloom):
    tab, _ = start(plugin)
    tab.on_message({"type": "save", "settings": {"url": printloom.url}})
    wait_for(lambda: plugin.CORE.info is not None)
    assert plugin.CORE.info["version"] == "1.1.40"


def test_seite_ist_eigenstaendig(plugin):
    html = plugin.PrintloomTab().get_ui()
    assert "orca.postMessage({type: 'ready'})" in html
    assert "http" not in html.replace("http://192.168.1.20", "").split("<script>")[0]
