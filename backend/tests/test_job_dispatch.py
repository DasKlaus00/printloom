"""Job-Verteilung auf mehrere Drucker.

Leitgedanke: EINDEUTIG vor CLEVER. Eine feste Zuweisung des Nutzers wird nie
stillschweigend umgangen — lieber wartet der Job, als auf einem Drucker zu landen,
den niemand gemeint hat. Automatik gilt nur für Jobs ohne Zuweisung."""
from app.services import job_dispatch as jd


def P(id, **kw):
    return {"id": id, "name": id, "device_id": 1, "enabled": True, "online": True,
            "busy": False, "queue_len": 0, "free_slots": 5, **kw}


# ── Eignung ──────────────────────────────────────────────────────────────────
def test_abgeschalteter_drucker_faellt_raus():
    assert jd.eligible(P("p1", enabled=False), {})[0] is False


def test_ohne_geraet_faellt_raus():
    ok, why = jd.eligible(P("p1", device_id=None), {})
    assert ok is False and "Gerät" in why


def test_nicht_erreichbar_faellt_raus():
    assert jd.eligible(P("p1", online=False), {})[0] is False


def test_zu_hohes_objekt_faellt_raus():
    ok, why = jd.eligible(P("p1", max_height_mm=250), {"objectHeight": 300})
    assert ok is False and "250" in why


def test_volles_regal_faellt_raus():
    ok, why = jd.eligible(P("p1", free_slots=0), {})
    assert ok is False and "Fach" in why


def test_passender_drucker_ist_geeignet():
    assert jd.eligible(P("p1", max_height_mm=250), {"objectHeight": 100}) == (True, "")


# ── Auswahl ──────────────────────────────────────────────────────────────────
def test_freier_drucker_vor_beschaeftigtem():
    pid, why = jd.pick_printer([P("p1", busy=True), P("p2")], {})
    assert pid == "p2" and why == "frei"


def test_kuerzeste_warteschlange_bei_gleichstand():
    pid, why = jd.pick_printer([P("p1", busy=True, queue_len=3),
                                P("p2", busy=True, queue_len=1)], {})
    assert pid == "p2" and "1" in why


def test_auswahl_ist_reproduzierbar():
    """Bei völligem Gleichstand darf die Wahl nicht von der Listenreihenfolge
    abhängen — sonst springt die Zuweisung bei jedem Neuladen."""
    a = jd.pick_printer([P("p2"), P("p1")], {})[0]
    b = jd.pick_printer([P("p1"), P("p2")], {})[0]
    assert a == b == "p1"


def test_feste_zuweisung_gewinnt():
    pid, why = jd.pick_printer([P("p1"), P("p2")], {"printer": "p2"})
    assert pid == "p2" and "zugewiesen" in why


def test_feste_zuweisung_wird_nicht_umgangen():
    """Der wichtige Fall: der zugewiesene Drucker kann gerade nicht — dann wartet
    der Job, statt woanders zu landen."""
    pid, why = jd.pick_printer([P("p1"), P("p2", free_slots=0)], {"printer": "p2"})
    assert pid is None and "zugewiesener Drucker" in why


def test_zuweisung_auf_geloeschten_drucker():
    pid, why = jd.pick_printer([P("p1")], {"printer": "weg"})
    assert pid is None and "existiert nicht" in why


def test_kein_drucker_nennt_die_gruende():
    pid, why = jd.pick_printer([P("p1", enabled=False), P("p2", free_slots=0)], {})
    assert pid is None
    assert "abgeschaltet" in why and "Fach" in why


def test_leere_liste():
    assert jd.pick_printer([], {}) == (None, "kein Drucker verfügbar")


# ── Ganze Warteschlange ──────────────────────────────────────────────────────
def test_verteilung_haeuft_nicht_alles_auf_einem():
    plan = jd.distribute([P("p1"), P("p2")],
                         [{"id": 1}, {"id": 2}, {"id": 3}, {"id": 4}])
    assert plan[1] == "p1" and plan[2] == "p2"      # erst beide einmal
    assert len({plan[3], plan[4]}) == 2             # dann wieder verteilt


def test_verteilung_respektiert_feste_zuweisungen():
    plan = jd.distribute([P("p1"), P("p2")],
                         [{"id": 1, "printer": "p2"}, {"id": 2}])
    assert plan[1] == "p2"
    assert plan[2] == "p1"


def test_verteilung_meldet_unverteilbare():
    plan = jd.distribute([P("p1", free_slots=0)], [{"id": 1}])
    assert plan[1] is None


def test_explain_nennt_alle_kandidaten():
    e = jd.explain([P("p1"), P("p2", enabled=False)], {})
    assert e["printer"] == "p1"
    assert len(e["candidates"]) == 2
    assert e["candidates"][1]["eligible"] is False
