"""Kompakt-Regal (seit v1.1.80): 16 mm Fachabstand, 24 Fächer, kein Magazin.

So hat Alex es beschrieben (18.11.2026):
- Leere Platten liegen in Regal 3 (bei 18 Platten in den Fächern 1–18); gegriffen wird
  die oberste, sie wird mit dem Magnet-Greifer angehoben und herausgezogen.
- Fertige Drucke füllen Regal 1 von OBEN nach unten, dann Regal 2 …
- Abgelegt wird waagerecht: Vorderkante an den Regaleingang, auf Fachhöhe hineinschieben.
  Ein Druck braucht nur seine Höhe plus eine kleine Zugabe.
- Über dem obersten Fach ist es offen.
Alle Daten in der echten Form (rack_store.default_data + apply_config).
"""
import pytest

from app.services import geometry_check, rack_logic, rack_store
from app.services import ottoeject_motion as motion


def kompakt(nr=3, spr=24, top_open=True, clearance=8, platten=0):
    data = rack_store.default_data(nr, spr)
    rack_store.apply_config(data, {"num_racks": nr, "slots_per_rack": spr, "slot_height_mm": 16,
                                   "rack_type": "compact", "compact_clearance_mm": clearance,
                                   "compact_top_open": top_open})
    if platten:
        rack_store.place_empty_plates(data, platten)
    return data


def ablegen(data, slot, hoehe):
    s = data["slots"][slot]
    s["status"], s["object_height_mm"] = "done", hoehe


# ── Konfiguration ───────────────────────────────────────────────────────────

def test_kompakt_hat_kein_magazin_und_24_faecher():
    data = kompakt()
    assert data["rack_type"] == "compact"
    assert data["magazine_slot"] == 0
    assert data["slots_per_rack"] == 24 and "3-24" in data["slots"]


def test_unbekannte_bauart_wird_abgelehnt():
    with pytest.raises(ValueError):
        rack_store.apply_config(rack_store.default_data(), {"rack_type": "turm"})


def test_oben_offen_ist_ohne_angabe_nein():
    data = rack_store.default_data(3, 24)
    data["rack_type"] = "compact"
    assert rack_logic.compact_top_open(data) is False


def test_belegung_eines_drucks():
    data = kompakt()
    assert rack_logic.compact_span(8, data) == 1     # (8 + 8) / 16 = 1 Fach
    assert rack_logic.compact_span(24, data) == 2    # genau 2, nicht durch Rundung 3
    assert rack_logic.compact_span(30, data) == 3    # 38 / 16 → 3
    assert rack_logic.compact_span(0, data) == 1


# ── Leere Platten ───────────────────────────────────────────────────────────

def test_18_platten_liegen_in_regal_3_faecher_1_bis_18():
    data = kompakt(platten=18)
    assert [f"{r}-{s}" for r, s in rack_logic.marked_empty_plates(data)] == \
        [f"3-{s}" for s in range(18, 0, -1)]


def test_mehr_platten_als_ein_regal_gehen_in_regal_2():
    data = kompakt()
    marked = rack_store.place_empty_plates(data, 30)
    assert marked[:24] == [f"3-{s}" for s in range(1, 25)]
    assert marked[24:] == [f"2-{s}" for s in range(1, 7)]


def test_zu_viele_platten_werden_abgelehnt():
    with pytest.raises(ValueError):
        rack_store.place_empty_plates(kompakt(nr=1), 25)


def test_neu_eintragen_ersetzt_die_alten_marken():
    data = kompakt(platten=18)
    rack_store.place_empty_plates(data, 5)
    assert rack_logic.empty_plate_count(data) == 5


def test_gegriffen_wird_die_oberste_leere_platte_aus_regal_3():
    data = kompakt()
    rack_store.place_empty_plates(data, 30)          # Regal 3 voll, Regal 2 Fächer 1–6
    assert rack_logic.plate_source(data) == (3, 24, False)
    data["slots"]["3-24"]["empty_plate"] = False      # gegriffen
    assert rack_logic.plate_source(data) == (3, 23, False)


# ── Ablage ──────────────────────────────────────────────────────────────────

def test_erster_druck_kommt_ganz_oben_in_regal_1():
    assert rack_logic.compact_store_slot(kompakt(platten=18), 30) == "1-24"


def test_naechste_drucke_haengen_darunter_an_mit_platz_fuer_ihre_hoehe():
    data = kompakt(platten=18)
    ablegen(data, "1-24", 30)
    # Der NEUE Druck (30 mm) braucht 3 Fächer bis zur Platte darüber: 24 − 3 = 21.
    assert rack_logic.compact_store_slot(data, 30) == "1-21"
    # Ein flacher Druck (8 mm) braucht nur ein Fach: direkt darunter.
    assert rack_logic.compact_store_slot(data, 8) == "1-23"


def test_keine_luecke_wird_nachgefuellt():
    data = kompakt()
    ablegen(data, "1-24", 30)
    ablegen(data, "1-21", 60)        # unter 21 ist die Lücke 22–23 frei, bleibt aber leer
    assert rack_logic.compact_store_slot(data, 8) == "1-20"


def test_reservierte_faecher_anderer_jobs_zaehlen_als_druck():
    data = kompakt()
    assert rack_logic.compact_store_slot(data, 8, {"1-24"}) == "1-23"


def test_ist_regal_1_voll_geht_es_in_regal_2():
    data = kompakt()
    ablegen(data, "1-2", 8)          # unterster Druck in Regal 1 bei Fach 2
    assert rack_logic.compact_store_slot(data, 30) == "2-24"   # 2 − 3 < 1
    assert rack_logic.compact_store_slot(data, 8) == "1-1"


def test_oben_zu_muss_der_erste_druck_in_die_faecher_passen():
    data = kompakt(top_open=False)
    assert rack_logic.compact_store_slot(data, 30) == "1-22"   # 22, 23, 24 frei


def test_zwischen_druck_und_leerer_platte_bleibt_ein_fach_frei():
    data = kompakt(nr=1, platten=20)          # ein Regal: Fächer 1–20 leer belegt
    assert rack_logic.compact_store_slot(data, 8) == "1-24"
    ablegen(data, "1-24", 8)
    assert rack_logic.compact_store_slot(data, 8) == "1-23"
    ablegen(data, "1-23", 8)
    # 22 läge direkt über der leeren Platte in 20? Nein: 22 − 20 = 2 → erlaubt.
    assert rack_logic.compact_store_slot(data, 8) == "1-22"
    ablegen(data, "1-22", 8)
    # 21 läge direkt auf der leeren Platte 20 → nicht erlaubt.
    assert rack_logic.compact_store_slot(data, 8) is None


def test_nie_auf_eine_leere_platte():
    data = kompakt(nr=1, platten=24)
    assert rack_logic.compact_store_slot(data, 8) is None


def test_storable_oben_offen_und_zu():
    assert rack_logic.storable(500, kompakt()) == {"ok": True, "slots_needed": 32,
                                                    "max_height_mm": None}
    zu = rack_logic.storable(500, kompakt(top_open=False))
    assert zu["ok"] is False and zu["max_height_mm"] == 24 * 16 - 8


# ── Farm-Fachsuche ──────────────────────────────────────────────────────────

def test_farm_waehlt_ueber_die_kompakt_regeln(monkeypatch):
    pytest.importorskip("fastapi")
    from app.routers import autofarm as af
    data = kompakt(platten=18)
    ablegen(data, "1-24", 30)
    monkeypatch.setattr(af, "_rack_data", lambda: data)
    monkeypatch.setitem(af._farm, "jobs", [{"id": 7, "slot": "1-21", "status": "running"}])
    # Fach 1-21 hält ein laufender Job → nächster 8-mm-Druck direkt darunter: 20.
    assert af._find_slot_for_height(8, exclude_job_id=1) == "1-20"


# ── Bewegung ────────────────────────────────────────────────────────────────

def geometrie(gripper="magnet", entry=230.0):
    g = motion.merge_defaults({
        "gripper": gripper, "compact_entry_mm": entry, "compact_lift_mm": 5,
        "rack_geo": {str(r): {"x": 100 + r * 200, "y_engage": 340, "first_z": 10,
                              "slot_gap": 16 - motion.SLOT_Z_EXTRA} for r in (1, 2, 3)},
    })
    data = kompakt()
    return motion.apply_rack_config(g, data)


def test_kompakt_faehrt_immer_printloom_gcode():
    g = geometrie()
    assert motion.is_compact(g)
    assert motion.op_uses_gcode(g, "grab") and motion.op_uses_gcode(g, "store")
    assert motion.magazine_slot(g) == 0


def test_holen_auf_fachhoehe_mit_kleinem_hub():
    g = geometrie()
    z3 = 10 + 2 * 16                      # Fach 3
    gc = motion.build_op(g, "grab", rack=3, slot=3, check=False)
    assert f"G1 Z{z3} F1000" in gc        # auf Fachhöhe unter die Platte
    assert "G1 Y340 F600" in gc           # ganz unter die Platte
    assert f"G1 Z{z3 + 5} F600" in gc     # nur 5 mm anheben


def test_ablegen_vorderkante_an_den_eingang_dann_hineinschieben():
    g = geometrie()
    z = 10 + 23 * 16                      # Fach 24
    lines = [l for l in motion.build_op(g, "store", rack=1, slot=24, check=False).splitlines()
             if l.startswith("G1")]
    y_eingang = 340 - 230
    assert f"Z{z + 5}" in lines[0]                         # quer auf Tragehöhe
    assert lines[1].startswith(f"G1 Y{y_eingang} ")        # Vorderkante am Eingang
    assert lines[2].startswith(f"G1 Z{z} ")                # auflegen, Arm auf Fachhöhe
    assert lines[3].startswith("G1 Y338 ")                 # hineinschieben (y_back 2)
    assert lines[4].startswith(f"G1 Z{z - 5} ")            # absenken → Magnet löst
    # Vorher nie über die Tragehöhe hinaus (bei 16 mm Abstand läge dort die Platte darüber)
    zs = [float(p[1:]) for l in lines for p in l.split() if p.startswith("Z")]
    assert max(zs) == z + 5


def test_ohne_einlege_punkt_keine_ablage():
    with pytest.raises(ValueError, match="Einlege-Punkt"):
        motion.build_op(geometrie(entry=None), "store", rack=1, slot=24, check=False)


def test_klemm_greifer_faehrt_nicht_still_eine_andere_bewegung():
    with pytest.raises(ValueError, match="Magnet-Greifer"):
        motion.build_op(geometrie(gripper="standard"), "grab", rack=3, slot=1, check=False)


def test_pruefung_meldet_fehlende_voraussetzungen():
    codes = {p["code"] for p in geometry_check.check_geometry(geometrie(gripper="standard",
                                                                          entry=None))["errors"]}
    assert {"compact_needs_magnet", "compact_entry_missing"} <= codes


def test_standard_regal_bleibt_unveraendert():
    g = motion.apply_rack_config(motion.merge_defaults({"gripper": "magnet"}),
                                 rack_store.default_data())
    assert not motion.is_compact(g)
    assert motion.op_uses_gcode(g, "grab") is False      # Standard: Geräte-Macro


# ── Endpunkte ───────────────────────────────────────────────────────────────

@pytest.fixture
def api(tmp_path, monkeypatch):
    pytest.importorskip("fastapi")
    from fastapi.testclient import TestClient
    from app.main import app
    from app.routers import autofarm
    monkeypatch.setattr(rack_store, "SLOTS_PATH", str(tmp_path / "rack_slots.json"))
    rack_store.ensure_file()
    monkeypatch.setitem(autofarm._farm, "running", False)
    monkeypatch.setitem(autofarm._stress, "running", False)
    return TestClient(app), autofarm


def test_einrichten_ueber_die_api(api):
    client, _ = api
    r = client.put("/api/rack-manager/config", json={
        "num_racks": 3, "slots_per_rack": 24, "slot_height_mm": 16, "rack_type": "compact",
        "compact_clearance_mm": 8, "compact_top_open": True})
    assert r.status_code == 200, r.text
    r = client.post("/api/rack-manager/compact/empty-plates", json={"count": 18})
    assert r.status_code == 200, r.text
    d = client.get("/api/rack-manager/").json()
    assert d["rack_type"] == "compact" and d["magazine_slot"] == 0
    assert d["compact_top_open"] is True and d["magazine_count"] == 18
    assert sorted(d["empty_plates"]) == sorted(f"3-{s}" for s in range(1, 19))


def test_leere_platten_nicht_waehrend_die_farm_laeuft(api, monkeypatch):
    client, autofarm = api
    client.put("/api/rack-manager/config", json={"slots_per_rack": 24, "rack_type": "compact"})
    monkeypatch.setitem(autofarm._farm, "running", True)
    assert client.post("/api/rack-manager/compact/empty-plates", json={"count": 3}).status_code == 409
    assert client.put("/api/rack-manager/config", json={"rack_type": "standard"}).status_code == 409


def test_leere_platten_nur_beim_kompakt_regal(api):
    client, _ = api
    assert client.post("/api/rack-manager/compact/empty-plates", json={"count": 3}).status_code == 400


def test_kein_stresstest_beim_kompakt_regal(api):
    client, autofarm = api
    client.put("/api/rack-manager/config", json={"slots_per_rack": 24, "rack_type": "compact"})
    assert client.get("/api/autofarm/stress-test/plan").status_code == 400
    r = client.post("/api/autofarm/stress-test", json={})
    assert r.status_code == 409 and "Kompakt-Regal" in r.text


def test_altes_formular_loescht_beim_kompakt_regal_keine_leerplatten():
    data = kompakt(platten=18)
    rack_store.apply_config(data, {"magazine_slot": 7, "slot_tolerance_mm": 20})
    assert data["magazine_slot"] == 0
    assert rack_logic.empty_plate_count(data) == 18


def test_zurueck_auf_standard_geht():
    data = kompakt()
    rack_store.apply_config(data, {"rack_type": "standard", "slots_per_rack": 6, "magazine_slot": 7})
    assert not rack_logic.is_compact(data) and data["magazine_slot"] == 7
