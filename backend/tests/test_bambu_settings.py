"""Drucker-Einstellungen am Bambu (Drucker-Tab): Report lesen + MQTT-Befehle bauen.

Zwei Fallen, die hier festgenagelt sind:
  • Unbekannt ist NICHT „aus". Ein fehlendes Feld im Report muss None ergeben,
    sonst zeigt die UI „aus" für etwas, das in Wahrheit an ist.
  • print_halt gehört nur an die Module, die den Druck anhalten können. Bei der
    Bauplatten-Erkennung würde es der Drucker sonst falsch auslegen."""
import pytest

from app.services import bambu_settings as bs

RAW = {"print": {
    "xcam": {"first_layer_inspector": True, "spaghetti_detector": False,
             "buildplate_marker_detector": True, "printing_monitor": True,
             "print_halt": True},
    "spd_lvl": 3,
    "auto_recovery_step_loss": True,
    "lights_report": [{"node": "chamber_light", "mode": "on"},
                      {"node": "work_light", "mode": "off"}],
    "nozzle_diameter": "0.4", "nozzle_type": "hardened_steel",
    "gcode_state": "IDLE",
}}


# ── Report lesen ─────────────────────────────────────────────────────────────
def test_liest_xcam_module():
    s = bs.read_settings(RAW)
    assert s["first_layer_inspector"] is True
    assert s["spaghetti_detector"] is False
    assert s["buildplate_marker_detector"] is True
    assert s["print_halt"] is True


def test_liest_geschwindigkeit_und_recovery():
    s = bs.read_settings(RAW)
    assert s["speed_level"] == 3 and s["speed_name"] == "sport"
    assert s["auto_recovery"] is True


def test_liest_licht_und_duese():
    s = bs.read_settings(RAW)
    assert s["chamber_light"] is True
    assert s["nozzle_diameter"] == "0.4" and s["nozzle_type"] == "hardened_steel"


def test_unbekannt_ist_none_nicht_false():
    """Der wichtigste Test hier: leerer Report darf nichts „aus" anzeigen."""
    s = bs.read_settings({"print": {}})
    assert all(s[k] is None for k in bs.XCAM_MODULES)
    assert s["speed_level"] is None
    assert s["auto_recovery"] is None
    assert s["chamber_light"] is None


def test_kaputte_werte_crashen_nicht():
    assert isinstance(bs.read_settings({}), dict)
    assert isinstance(bs.read_settings(None), dict)
    assert bs.read_settings({"print": {"spd_lvl": "x"}})["speed_level"] is None
    assert bs.read_settings({"print": {"spd_lvl": 9}})["speed_level"] is None


def test_explizites_aus_bleibt_aus():
    assert bs.read_settings(
        {"print": {"lights_report": [{"node": "chamber_light", "mode": "off"}]}}
    )["chamber_light"] is False
    assert bs.read_settings({"print": {"auto_recovery_step_loss": False}})["auto_recovery"] is False


# ── Befehle bauen ────────────────────────────────────────────────────────────
def test_xcam_befehl():
    c = bs.build_command("first_layer_inspector", True)
    assert c["xcam"]["command"] == "xcam_control_set"
    assert c["xcam"]["module_name"] == "first_layer_inspector"
    assert c["xcam"]["enable"] is True
    assert c["xcam"]["control"] is True
    assert c["xcam"]["print_halt"] is True
    assert "sequence_id" in c["xcam"]


def test_print_halt_folgt_dem_schalter():
    c = bs.build_command("spaghetti_detector", False)
    assert c["xcam"]["enable"] is False and c["xcam"]["print_halt"] is False


def test_bauplatten_erkennung_ohne_print_halt():
    assert "print_halt" not in bs.build_command("buildplate_marker_detector", True)["xcam"]


def test_geschwindigkeit_licht_recovery():
    c = bs.build_command("speed_level", 4)
    assert c["print"]["command"] == "print_speed" and c["print"]["param"] == "4"
    c = bs.build_command("auto_recovery", True)
    assert c["print"]["command"] == "print_option" and c["print"]["auto_recovery"] is True
    c = bs.build_command("chamber_light", False)
    assert c["system"]["command"] == "ledctrl"
    assert c["system"]["led_mode"] == "off" and c["system"]["led_node"] == "chamber_light"


@pytest.mark.parametrize("key", ["nope", ""])
def test_unbekannter_schluessel_wirft(key):
    with pytest.raises(ValueError):
        bs.build_command(key, True)


@pytest.mark.parametrize("lvl", [0, 5, -1])
def test_geschwindigkeit_ausserhalb_1_bis_4_wirft(lvl):
    with pytest.raises(ValueError):
        bs.build_command("speed_level", lvl)


def test_abgeloeste_teile_bewusst_nicht_anbietbar():
    """v1.0.161: „Abgelöste Teile überspringen" steckt im xcam-Block des Druckers,
    ist aber keine Einstellung, die man am Drucker umschaltet — deshalb nicht in
    der Liste. Ohne diesen Test schleicht sie sich beim nächsten Ausbau zurück."""
    assert "allow_skip_parts" not in bs.XCAM_MODULES


# ── Kalibrierung (Bitmaske) ──────────────────────────────────────────────────
def test_kalibrierungs_bitmaske():
    assert bs.build_calibration(["bed_leveling"])["print"]["option"] == 2
    assert bs.build_calibration(["vibration_compensation"])["print"]["option"] == 4
    assert bs.build_calibration(["motor_noise_cancellation"])["print"]["option"] == 8
    assert bs.build_calibration(["bed_leveling", "vibration_compensation"])["print"]["option"] == 6
    assert bs.build_calibration(list(bs.CALIBRATION_BITS))["print"]["option"] == 14
    assert bs.build_calibration(["bed_leveling", "bed_leveling"])["print"]["option"] == 2
    assert bs.build_calibration(["bed_leveling"])["print"]["command"] == "calibration"


@pytest.mark.parametrize("bad", [[], None, ["quatsch"]])
def test_kalibrierung_ohne_gueltige_option_wirft(bad):
    with pytest.raises(ValueError):
        bs.build_calibration(bad)
