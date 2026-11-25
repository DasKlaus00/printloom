"""Snapmaker U1 (Moonraker-Drucker, seit v1.1.83).

Die Rohdaten haben die echte Form von Moonraker (`/printer/objects/list`,
`/printer/objects/query` → {"result": {"status": …}}); die U1-Eigenheiten
(led cavity_led, purifier, print_task_config, filament_motion_sensor e0–e3) so,
wie die Home-Assistant-Integration kbaker827/ha-snapmaker-u1 sie liest.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402
from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.models.models import Base, Device, PrinterType  # noqa: E402
from app.routers import control, printer  # noqa: E402
from app.services import moonraker_printer as mp  # noqa: E402
from app.services import printer_models  # noqa: E402

OBJECTS = ["webhooks", "configfile", "print_stats", "virtual_sdcard", "display_status",
           "idle_timeout", "gcode_move", "toolhead", "fan", "heater_bed", "extruder",
           "extruder1", "extruder2", "extruder3", "led cavity_led", "purifier",
           "print_task_config", "filament_motion_sensor e0", "filament_motion_sensor e1",
           "filament_motion_sensor e2", "filament_motion_sensor e3",
           "temperature_sensor cavity", "gcode_macro PAUSE", "exclude_object"]


def u1_status(state="printing", klippy="ready"):
    return {
        "webhooks": {"state": klippy, "state_message": "Printer is ready"},
        "print_stats": {"state": state, "filename": "halter.gcode", "print_duration": 1200.0,
                        "total_duration": 1300.0, "filament_used": 812.3,
                        "info": {"current_layer": 42, "total_layer": 120}},
        "virtual_sdcard": {"progress": 0.25, "is_active": True},
        "display_status": {"progress": 0.24, "message": None},
        "toolhead": {"extruder": "extruder1", "homed_axes": "xyz"},
        "gcode_move": {"speed_factor": 1.0, "extrude_factor": 0.95},
        "fan": {"speed": 0.5},
        "heater_bed": {"temperature": 60.1, "target": 60.0, "power": 0.3},
        "extruder": {"temperature": 25.0, "target": 0.0, "power": 0.0, "can_extrude": False},
        "extruder1": {"temperature": 219.8, "target": 220.0, "power": 0.4, "can_extrude": True},
        "extruder2": {"temperature": 24.0, "target": 0.0, "power": 0.0},
        "extruder3": {"temperature": 24.5, "target": 0.0, "power": 0.0},
        "led cavity_led": {"color_data": [[0.0, 0.0, 0.0, 1.0]]},
        "purifier": {"power_detected": True, "mode": 1, "desired_chamber_temp": 42,
                     "inner_fan_rpm": 1800, "exhaust_fan": {"speed": 0.6, "delay": 0},
                     "inner_fan": {"speed": 0.3, "delay": 0}},
        "print_task_config": {"filament_vendor": ["Snapmaker", "Bambu", "NONE", ""],
                              "filament_type": ["PLA", "PETG", "NONE", ""],
                              "filament_sub_type": ["Basic", "HF", "", ""],
                              "filament_color_rgba": ["FF6A00FF", "#00aaff", "NONE", ""],
                              "filament_exist": [True, True, False, False],
                              "filament_official": [True, False, False, False]},
        "filament_motion_sensor e0": {"enabled": True, "filament_detected": True},
        "filament_motion_sensor e1": {"enabled": True, "filament_detected": True},
        "filament_motion_sensor e2": {"enabled": True, "filament_detected": False},
        "filament_motion_sensor e3": {"enabled": False, "filament_detected": False},
        "temperature_sensor cavity": {"temperature": 31.5},
    }


# ── Auswertung ───────────────────────────────────────────────────────────────
def test_objekte_nur_was_printloom_liest():
    picked = mp.pick_objects(OBJECTS)
    assert "led cavity_led" in picked and "purifier" in picked and "print_task_config" in picked
    assert {"extruder", "extruder1", "extruder2", "extruder3"} <= set(picked)
    assert "filament_motion_sensor e3" in picked and "temperature_sensor cavity" in picked
    assert "gcode_macro PAUSE" not in picked and "configfile" not in picked


def test_status_in_printloom_form():
    s = mp.normalize(u1_status())
    assert s["gcode_state"] == "RUNNING" and s["is_printing"] and s["status"] == "printing"
    assert s["progress"] == 25.0
    assert s["remaining_min"] == 60                 # 1200 s bei 25 % → noch 3600 s
    assert s["subtask_name"] == "halter.gcode" and (s["layer"], s["total_layers"]) == (42, 120)
    assert s["active_tool"] == 1 and s["nozzle_temp"] == 219.8 and s["nozzle_target_temp"] == 220.0
    assert (s["bed_temp"], s["bed_target_temp"]) == (60.1, 60.0)
    assert (s["speed_factor"], s["flow_factor"], s["fan_speed"]) == (100, 95, 50.0)
    assert s["work_light"] is True
    assert s["top_cover"]["mode"] == 1 and s["top_cover"]["exhaust_fan"] == 60.0
    assert s["temperature_sensors"] == [{"name": "cavity", "temp": 31.5}]


def test_filament_und_sensor_je_kopf():
    tools = mp.normalize(u1_status())["tools"]
    assert [t["label"] for t in tools] == ["T0", "T1", "T2", "T3"]
    assert tools[0]["filament"] == {"vendor": "Snapmaker", "type": "PLA", "sub_type": "Basic",
                                    "color": "#FF6A00", "loaded": True, "official": True}
    assert tools[1]["filament"]["color"] == "#00AAFF"
    # „NONE" und leer heißt unbekannt — nicht als Text anzeigen.
    assert tools[2]["filament"] == {"vendor": None, "type": None, "sub_type": None,
                                    "color": None, "loaded": False, "official": False}
    assert tools[2]["sensor"] == {"detected": False, "enabled": True}
    assert tools[3]["sensor"]["enabled"] is False


def test_unbekannt_ist_nicht_null():
    s = mp.normalize({"print_stats": {"state": "standby"}, "webhooks": {"state": "ready"}})
    assert s["progress"] is None and s["remaining_min"] is None
    assert s["bed_temp"] is None and s["fan_speed"] is None and s["speed_factor"] is None
    assert s["work_light"] is None and s["top_cover"] is None and s["tools"] == []
    assert s["gcode_state"] == "IDLE"


def test_abgebrochen_ist_frei_und_klipper_aus_ist_fehler():
    assert mp.normalize(u1_status("cancelled"))["gcode_state"] == "IDLE"
    assert mp.normalize(u1_status("complete"))["gcode_state"] == "FINISH"
    s = mp.normalize(u1_status("standby", klippy="shutdown"))
    assert s["status"] == "shutdown" and s["gcode_state"] == "FAILED"


# ── Einstellungen → G-code (wörtlich wie pysnapmaker) ────────────────────────
CAPS = mp.capabilities(mp.pick_objects(OBJECTS), "u1")


def test_faehigkeiten_des_u1():
    assert CAPS == {"work_light": True, "top_cover": True, "filament_info": True,
                    "tools": [0, 1, 2, 3], "max_nozzle_c": 300}


@pytest.mark.parametrize("key,value,gcode", [
    ("speed_factor", 150, ["M220 S150"]),
    ("flow_factor", 95, ["M221 S95"]),
    ("fan_speed", 50, ["M106 S128"]),
    ("fan_speed", 0, ["M106 S0"]),
    ("work_light", True, ["SET_LED LED=cavity_led RED=1 GREEN=1 BLUE=1 WHITE=1"]),
    ("work_light", False, ["SET_LED LED=cavity_led RED=0 GREEN=0 BLUE=0 WHITE=0"]),
    ("top_cover_mode", 0, ["SET_PURIFIER_MODE MODE=0"]),
    ("top_cover_mode", 1, ["SET_PURIFIER_MODE MODE=1 DESIRE_TEMP=42 ALARM_TEMP=48 FAN_SPEED=0.6"]),
    ("top_cover_mode", 3, ["SET_PURIFIER_MODE MODE=3 DESIRE_TEMP=45 FAN_SPEED=0.6"]),
    ("top_cover_exhaust", 60, ["SET_PURIFIER FAN=exhaust SPEED=0.60"]),
    ("top_cover_inner", 0, ["SET_PURIFIER FAN=inner SPEED=0 DELAY_OFF=0"]),
    ("bed_target", 60, ["M140 S60"]),
    ("nozzle_target", {"tool": 2, "temp": 215}, ["SET_HEATER_TEMPERATURE HEATER=extruder2 TARGET=215"]),
    ("nozzle_target", {"tool": 0, "temp": 0}, ["SET_HEATER_TEMPERATURE HEATER=extruder TARGET=0"]),
])
def test_einstellung_wird_zu_gcode(key, value, gcode):
    assert mp.build_setting(key, value, CAPS) == gcode


def test_duesentemperatur_wechselt_nie_den_kopf():
    # „T1 / M104" würde beim U1 den Kopf tauschen — eine echte Bewegung.
    lines = mp.build_setting("nozzle_target", {"tool": 1, "temp": 200}, CAPS)
    assert not any(line.startswith("T") for line in lines)


@pytest.mark.parametrize("key,value", [
    ("speed_factor", 5), ("speed_factor", 250), ("flow_factor", True), ("fan_speed", "viel"),
    ("fan_speed", float("nan")), ("top_cover_mode", 4), ("top_cover_mode", 1.5),
    ("nozzle_target", {"tool": 4, "temp": 200}), ("nozzle_target", {"tool": 0, "temp": 301}),
    ("bed_target", -1), ("work_light", "an"), ("unbekannt", 1),
])
def test_unsinn_wird_abgelehnt(key, value):
    with pytest.raises(ValueError):
        mp.build_setting(key, value, CAPS)


def test_ohne_licht_und_top_cover_keine_befehle_dafuer():
    caps = mp.capabilities(["print_stats", "extruder"], "u1")
    for key, value in (("work_light", True), ("top_cover_mode", 0), ("top_cover_exhaust", 50)):
        with pytest.raises(ValueError):
            mp.build_setting(key, value, caps)


# ── Kamera ───────────────────────────────────────────────────────────────────
DEV = Device(id=7, name="U1", device_type=PrinterType.MOONRAKER, model="u1",
             ip_address="192.0.2.30", port=7125)


def test_kamera_pfade():
    assert mp.camera_urls(DEV, None) == ("http://192.0.2.30/webcam/snapshot.jpg",
                                         "http://192.0.2.30/webcam/stream.mjpg")
    cams = [{"name": "gui", "snapshot_url": "/screen/snap.jpg"},
            {"name": "intern", "enabled": True, "snapshot_url": "/webcam/?action=snapshot",
             "stream_url": "http://127.0.0.1/webcam/?action=stream"}]
    assert mp.camera_urls(DEV, cams) == ("http://192.0.2.30/webcam/?action=snapshot",
                                         "http://192.0.2.30/webcam/?action=stream")


def test_kamera_ruft_nie_fremde_adressen():
    cams = [{"name": "cam", "snapshot_url": "http://203.0.113.5/x.jpg",
             "stream_url": "http://evil.example/stream"}]
    snap, stream = mp.camera_urls(DEV, cams)
    assert "203.0.113.5" not in snap and "evil" not in stream


def test_erstes_jpeg_aus_dem_strom():
    jpg = b"\xff\xd8abc\xff\xd9"
    assert mp.first_jpeg(b"--frame\r\n\r\n" + jpg + b"\r\n--frame") == jpg
    assert mp.first_jpeg(b"--frame\r\n\xff\xd8halb") is None


def test_modell_u1():
    assert printer_models.driver("u1") == "moonraker" and printer_models.driver("x1c") == "bambu"
    assert printer_models.normalize("Snapmaker U1") == "u1"
    assert printer_models.normalize("Bambu Lab X1 Carbon") == "x1c"
    u1 = next(m for m in printer_models.public_list() if m["id"] == "u1")
    assert u1["tools"] == 4 and u1["max_nozzle_c"] == 300 and u1["preset"] is None


# ── Endpunkte (Drucker per Fake-Moonraker) ───────────────────────────────────
@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False},
                           poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    s = sessionmaker(bind=engine)()
    yield s
    s.close()
    engine.dispose()


@pytest.fixture
def u1(db, monkeypatch):
    """Ein U1 in der Datenbank und ein Fake-Moonraker: GET/POST antworten mit
    `result` wie die echte API, gesendete G-codes landen in `sent`."""
    d = Device(name="U1", device_type=PrinterType.MOONRAKER, model="u1",
               ip_address="192.0.2.30", port=7125)
    db.add(d)
    db.commit()
    fake = {"status": u1_status("standby"), "sent": [], "posts": []}
    mp._objects_cache.clear()

    async def fake_get(device, path, params=None, timeout=5.0):
        if path == "/printer/objects/list":
            return {"objects": OBJECTS}
        if path == "/server/files/list":
            return [{"path": "alt.gcode", "modified": 1.0}, {"path": "neu.gcode", "modified": 2.0}]
        raise AssertionError(path)

    async def fake_post(device, path, json=None, timeout=5.0):
        fake["posts"].append((path, json))
        if path == "/printer/objects/query":
            return {"status": {k: v for k, v in fake["status"].items() if k in json["objects"]}}
        if path == "/printer/gcode/script":
            fake["sent"].append(json["script"])
            return "ok"
        return "ok"

    monkeypatch.setattr(mp, "_get", fake_get)
    monkeypatch.setattr(mp, "_post", fake_post)
    return d, fake


def run(coro):
    return asyncio.run(coro)


def test_status_endpunkt_liefert_u1(db, u1):
    d, _ = u1
    s = run(printer.get_printer_status(d.id, db=db))
    assert s["driver"] == "moonraker" and s["gcode_state"] == "IDLE"
    assert s["capabilities"]["tools"] == [0, 1, 2, 3]


def test_einstellungen_lesen_und_setzen(db, u1):
    d, fake = u1
    r = run(printer.get_printer_settings(d.id, db=db))
    assert r["driver"] == "moonraker" and r["settings"]["work_light"] is True
    r = run(printer.set_printer_settings(d.id, {"work_light": False, "speed_factor": 120,
                                                "fan_speed": 999}, db=db))
    assert r["applied"] == ["work_light", "speed_factor"] and "fan_speed" in r["failed"]
    assert fake["sent"] == ["SET_LED LED=cavity_led RED=0 GREEN=0 BLUE=0 WHITE=0", "M220 S120"]


def test_notaus_sperrt_heizen_aber_nicht_ausschalten(db, u1):
    d, fake = u1
    d.is_active = False                              # so sieht ein aktiver Notaus aus
    db.commit()
    r = run(printer.set_printer_settings(d.id, {"nozzle_target": {"tool": 0, "temp": 0},
                                                "bed_target": 60}, db=db))
    assert r["applied"] == ["nozzle_target"] and "bed_target" in r["failed"]
    assert fake["sent"] == ["SET_HEATER_TEMPERATURE HEATER=extruder TARGET=0"]
    with pytest.raises(HTTPException) as e:
        run(printer.moonraker_action(d.id, {"action": "resume"}, db=db))
    assert e.value.status_code == 409
    run(printer.moonraker_action(d.id, {"action": "pause"}, db=db))   # anhalten geht immer


def test_druck_startet_nur_bei_freiem_drucker(db, u1):
    d, fake = u1
    fake["status"] = u1_status("printing")
    with pytest.raises(HTTPException) as e:
        run(printer.moonraker_print(d.id, {"filename": "neu.gcode"}, db=db))
    assert e.value.status_code == 409
    fake["status"] = u1_status("complete")
    run(printer.moonraker_print(d.id, {"filename": "neu.gcode"}, db=db))
    assert ("/printer/print/start", {"filename": "neu.gcode"}) in fake["posts"]
    with pytest.raises(HTTPException) as e:
        run(printer.moonraker_print(d.id, {"filename": "../etc/passwd"}, db=db))
    assert e.value.status_code == 400


def test_dateien_neueste_zuerst(db, u1):
    d, _ = u1
    files = run(printer.moonraker_files(d.id, db=db))["files"]
    assert [f["path"] for f in files] == ["neu.gcode", "alt.gcode"]


def test_unbekannte_aktion_und_bambu_geraet(db, u1):
    d, _ = u1
    with pytest.raises(HTTPException) as e:
        run(printer.moonraker_action(d.id, {"action": "explode"}, db=db))
    assert e.value.status_code == 400
    b = Device(name="X1C", device_type=PrinterType.BAMBU_LAB, model="x1c", ip_address="192.0.2.5", port=990)
    db.add(b)
    db.commit()
    with pytest.raises(HTTPException) as e:
        run(printer.moonraker_files(b.id, db=db))
    assert e.value.status_code == 404


def test_notaus_pausiert_den_druckenden_u1(db, u1, monkeypatch):
    d, fake = u1
    fake["status"] = u1_status("printing")
    erg = run(control._pause_printers(db))
    assert erg == [{"name": "U1", "ok": True}]
    assert ("/printer/print/pause", None) in fake["posts"]
    fake["posts"].clear()
    fake["status"] = u1_status("standby")
    assert run(control._pause_printers(db)) == [{"name": "U1", "ok": True}]
    assert ("/printer/print/pause", None) not in fake["posts"]   # nichts zu pausieren


def test_u1_ist_nie_der_arm(db, u1):
    # Die Farm und der Notaus nehmen Klipper-Geräte als OTTOeject — der U1 ist keins.
    arme, tasks = control._klipper_estop_start(db)
    for t in tasks:
        t.cancel()
    assert arme == []


def test_neues_moonraker_geraet_ist_ein_u1(db):
    from app.routers import devices
    from app.schemas.schemas import DeviceCreate
    d = run(devices.create_device(DeviceCreate(name="U1", device_type=PrinterType.MOONRAKER,
                                               model="x1c", ip_address="192.0.2.30", port=7125), db=db))
    assert d.model == "u1"            # ein Bambu-Modell passt nicht zu Moonraker
    b = run(devices.create_device(DeviceCreate(name="X1C", device_type=PrinterType.BAMBU_LAB,
                                               model="x1c", ip_address="192.0.2.5", port=8883), db=db))
    assert b.model == "x1c"


def test_netzwerksuche_haelt_den_u1_nicht_fuer_den_arm():
    from app.services import discovery
    assert discovery.moonraker_kind(OBJECTS) == "printer"
    # So meldet sich der OTTOeject (printer.cfg: stepper_x/y/z, kein Extruder).
    arm = ["webhooks", "configfile", "toolhead", "stepper_enable", "tmc2209 stepper_x",
           "gcode_macro OTTOEJECT_HOME", "print_stats", "virtual_sdcard"]
    assert discovery.moonraker_kind(arm) == "arm"
    assert discovery.moonraker_kind(None) == "unknown"
