"""Leerplatten-Markierung im Rack Manager (Aufbau OHNE Magazin, seit v1.0.163).

Was hier schiefgehen kann und deshalb festgenagelt ist:
  • Die Migration aus dem alten Zähler darf GENAU EINMAL laufen. Läuft sie erneut,
    tauchen nach dem Griff der letzten Platte wieder Platten auf, die es nicht
    gibt — die Farm würde ins Leere greifen.
  • Ein Fach, in dem ein Druck liegt, darf nie als „Leerplatte" markiert sein.
  • Nimmt man ohne Magazin den fertigen Druck heraus, bleibt die PLATTE im Fach
    liegen (man legt sie ja zurück) — das Fach hält danach wieder eine leere.
"""
import pytest

pytest.importorskip("fastapi")
pytest.importorskip("httpx")

from app.routers import rack_manager as rm  # noqa: E402
from app.services import rack_logic  # noqa: E402


@pytest.fixture
def store(tmp_path, monkeypatch):
    """Eigene rack_slots.json je Test."""
    monkeypatch.setattr(rm, "SLOTS_PATH", str(tmp_path / "rack_slots.json"))
    return tmp_path


def _write(data):
    rm._save(data)


def _data(magazine_slot=0, counts=None, num_racks=2, spr=6, slots=None):
    base = {
        "num_racks": num_racks, "slots_per_rack": spr, "slot_height_mm": 50,
        "magazine_slot": magazine_slot,
        "magazine_defaults": [4] * num_racks,
        "magazine_counts": counts if counts is not None else [4] * num_racks,
        "slots": slots or {f"{r}-{s}": rm._default_slot()
                           for r in range(1, num_racks + 1) for s in range(1, spr + 1)},
    }
    return base


# ── Migration aus dem alten Zähler ───────────────────────────────────────────
def test_migration_markiert_die_unteren_faecher(store):
    _write(_data(magazine_slot=0, counts=[3, 1]))
    data = rm._load()
    assert {f"{r}-{s}" for r, s in rack_logic.marked_empty_plates(data)} == \
        {"1-1", "1-2", "1-3", "2-1"}


def test_migration_laeuft_nur_einmal(store):
    """Der entscheidende Test: nach dem Griff der letzten Platte darf sie nicht
    wieder erscheinen."""
    _write(_data(magazine_slot=0, counts=[2, 0]))
    data = rm._load()
    assert len(rack_logic.marked_empty_plates(data)) == 2
    # Farm greift beide Platten → keine Markierung mehr
    for key in ("1-1", "1-2"):
        data["slots"][key]["empty_plate"] = False
    _write(data)
    again = rm._load()
    assert rack_logic.marked_empty_plates(again) == []
    assert rack_logic.empty_plate_count(again) == 0


def test_migration_ueberspringt_belegte_faecher(store):
    """Wo ein Druck liegt, liegt keine leere Platte."""
    d = _data(magazine_slot=0, counts=[3, 0])
    d["slots"]["1-2"]["status"] = "done"
    _write(d)
    data = rm._load()
    assert not data["slots"]["1-2"].get("empty_plate")
    assert data["slots"]["1-1"]["empty_plate"] is True


def test_migration_bleibt_bei_magazin_aus(store):
    """Mit Magazin gibt es keine Fach-Markierungen — der Zähler regiert."""
    _write(_data(magazine_slot=7, counts=[4, 4]))
    data = rm._load()
    assert rack_logic.marked_empty_plates(data) == []
    assert rack_logic.empty_plate_count(data) == 8


def test_migration_kappt_bei_der_fachzahl(store):
    """Zähler größer als das Regal (falsch eingetippt) darf nichts erfinden."""
    _write(_data(magazine_slot=0, counts=[99, 0], spr=6))
    data = rm._load()
    assert len(rack_logic.marked_empty_plates(data)) == 6


# ── Markieren über den Endpoint ──────────────────────────────────────────────
def test_markieren_und_aufheben(store):
    _write(_data(magazine_slot=0, counts=[0, 0]))
    rm._load()
    rm.update_slot("1-4", {"empty_plate": True}, db=None)
    assert rm._load()["slots"]["1-4"]["empty_plate"] is True
    rm.update_slot("1-4", {"empty_plate": False}, db=None)
    assert rm._load()["slots"]["1-4"]["empty_plate"] is False


def test_markieren_mit_magazin_wird_abgelehnt(store):
    """Sonst käme der Nachschub aus zwei Quellen gleichzeitig."""
    from fastapi import HTTPException
    _write(_data(magazine_slot=7))
    rm._load()
    with pytest.raises(HTTPException):
        rm.update_slot("1-4", {"empty_plate": True}, db=None)


def test_belegtes_fach_kann_nicht_markiert_werden(store):
    from fastapi import HTTPException
    d = _data(magazine_slot=0, counts=[0, 0])
    d["slots"]["1-4"]["status"] = "done"
    _write(d)
    rm._load()
    with pytest.raises(HTTPException):
        rm.update_slot("1-4", {"empty_plate": True}, db=None)


def test_markierung_verschwindet_wenn_ein_druck_reinkommt(store):
    """Doppelte Absicherung: selbst wenn beides gleichzeitig gesetzt wird, gewinnt
    der Druck — sonst würde die Farm aus einem belegten Fach greifen."""
    _write(_data(magazine_slot=0, counts=[0, 0]))
    rm._load()
    rm.update_slot("1-4", {"empty_plate": True}, db=None)
    rm.update_slot("1-4", {"status": "done", "file_name": "x.3mf"}, db=None)
    assert rm._load()["slots"]["1-4"]["empty_plate"] is False


# ── Fertigen Druck entnehmen ─────────────────────────────────────────────────
def test_entnehmen_laesst_die_platte_im_fach(store):
    """Ohne Magazin: Druck abnehmen, Platte zurück ins Fach → wieder Leerplatte."""
    d = _data(magazine_slot=0, counts=[0, 0])
    d["slots"]["1-3"].update({"status": "done", "file_name": "teil.3mf",
                              "object_height_mm": 40})
    _write(d)
    rm._load()
    rm.update_slot("1-3", {"status": "free"}, db=None)
    slot = rm._load()["slots"]["1-3"]
    assert slot["empty_plate"] is True
    assert slot["object_height_mm"] is None and slot["file_name"] is None


def test_entnehmen_mit_magazin_zaehlt_das_magazin_hoch(store):
    """Mit Magazin wandert die Platte oben in den Stapel — Verhalten unverändert."""
    d = _data(magazine_slot=7, counts=[0, 0])
    d["slots"]["1-3"].update({"status": "done", "file_name": "teil.3mf"})
    _write(d)
    rm._load()
    rm.update_slot("1-3", {"status": "free"}, db=None)
    data = rm._load()
    assert data["magazine_counts"][0] == 1
    assert not data["slots"]["1-3"].get("empty_plate")


def test_alle_entnehmen_ohne_magazin(store):
    d = _data(magazine_slot=0, counts=[0, 0])
    for key in ("1-2", "2-5"):
        d["slots"][key].update({"status": "done", "file_name": "t.3mf"})
    _write(d)
    rm._load()
    rm.clear_slots({"status": "done"})
    data = rm._load()
    assert data["slots"]["1-2"]["empty_plate"] is True
    assert data["slots"]["2-5"]["empty_plate"] is True


def test_entnehmen_mit_ausdruecklicher_angabe(store):
    """Wer die Platte MITNIMMT, sagt es beim Leeren — dann wird nicht markiert."""
    d = _data(magazine_slot=0, counts=[0, 0])
    d["slots"]["1-3"].update({"status": "done", "file_name": "teil.3mf"})
    _write(d)
    rm._load()
    rm.update_slot("1-3", {"status": "free", "empty_plate": False}, db=None)
    assert rm._load()["slots"]["1-3"]["empty_plate"] is False


# ── Umschalten der Bauart (Setup-Assistent) ──────────────────────────────────
def test_umschalten_auf_ohne_magazin_erfindet_keine_platten(store):
    """Wer gerade erst umstellt, hat noch nichts eingelegt — der Magazin-Zähler
    darf keine Platten in die Fächer zaubern."""
    _write(_data(magazine_slot=7, counts=[4, 4]))
    rm.update_config({"magazine_slot": 0}, db=None)
    data = rm._load()
    assert rack_logic.marked_empty_plates(data) == []
    assert rack_logic.empty_plate_count(data) == 0


def test_umschalten_auf_magazin_loescht_markierungen(store):
    """Sonst blieben markierte Fächer als Ablage blockiert, obwohl der Nachschub
    jetzt aus dem Magazin kommt."""
    _write(_data(magazine_slot=0, counts=[2, 0]))
    assert len(rack_logic.marked_empty_plates(rm._load())) == 2
    rm.update_config({"magazine_slot": 7}, db=None)
    data = rm._load()
    assert rack_logic.marked_empty_plates(data) == []
    assert rack_logic.reserved_source_slots(data) == set()


# ── Der Farm-Zyklus: greifen → Markierung löschen → nächste Platte ───────────
def test_griff_arbeitet_die_markierten_faecher_von_oben_ab(store, monkeypatch):
    """„grab from magazine" holt ohne Magazin aus dem Fach, in dem eine Platte
    liegt — und zwar dem obersten. Nach dem Griff ist die Markierung weg, der
    nächste Griff nimmt das nächsttiefere Fach."""
    from app.routers import autofarm
    d = _data(magazine_slot=0, counts=[0, 0])
    for key in ("1-2", "1-5"):
        d["slots"][key]["empty_plate"] = True
    d["empty_plates_migrated"] = True
    _write(d)
    monkeypatch.setattr(autofarm, "SLOTS_PATH", rm.SLOTS_PATH)

    assert autofarm._magazine_count() == 2
    assert autofarm._stack_vars() == ("1", "5")      # oberstes zuerst

    autofarm._decrement_magazine(1, 5)
    assert rm._load()["slots"]["1-5"]["empty_plate"] is False
    assert autofarm._magazine_count() == 1
    assert autofarm._stack_vars() == ("1", "2")      # jetzt das nächsttiefere

    autofarm._decrement_magazine()                    # ohne Angabe = aktuelle Quelle
    assert rm._load()["slots"]["1-2"]["empty_plate"] is False
    assert autofarm._magazine_count() == 0

    # Leer bleibt leer — der Zähler darf nicht wieder einspringen.
    assert autofarm._magazine_count() == 0


def test_griff_mit_magazin_zieht_den_zaehler(store, monkeypatch):
    from app.routers import autofarm
    _write(_data(magazine_slot=7, counts=[2, 4]))
    monkeypatch.setattr(autofarm, "SLOTS_PATH", rm.SLOTS_PATH)
    assert autofarm._stack_vars() == ("1", "7")
    autofarm._decrement_magazine()
    assert rm._load()["magazine_counts"] == [1, 4]


# ── Rückgabe an die UI ───────────────────────────────────────────────────────
def test_get_all_meldet_die_markierten_faecher(store):
    _write(_data(magazine_slot=0, counts=[2, 0]))
    r = rm.get_all(db=None)
    assert set(r["empty_plates"]) == {"1-1", "1-2"}
    assert r["magazine_count"] == 2          # Badge zählt die Platten, nicht die Zähler
    assert r["magazine_total"] == 12         # ohne Magazin: alle Fächer als Nenner


def test_get_all_mit_magazin_unveraendert(store):
    _write(_data(magazine_slot=7, counts=[4, 3]))
    r = rm.get_all(db=None)
    assert r["empty_plates"] == []
    assert r["magazine_count"] == 7
    assert r["magazine_total"] == 8          # Summe der Sollwerte
