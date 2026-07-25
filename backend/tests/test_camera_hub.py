"""Geteilter Kamera-Hub: EIN Producer je Drucker, Fan-out an alle Zuschauer.

Der Hub ist der Grund, warum mehrere offene Kameraansichten nicht mehrere
ffmpeg-Prozesse starten. Wichtig ist außerdem, dass ein nicht erreichbarer
Drucker mit dem ECHTEN Grund fehlschlägt (statt „irgendwie kein Bild") und dass
kein toter Hub in der Registry hängen bleibt — sonst bliebe die Ansicht
dauerhaft schwarz."""
import threading
import time

import pytest

from app.services import camera_hub as hub


@pytest.fixture(autouse=True)
def _aufraeumen():
    """Nach jedem Test alle Hubs beenden — sonst leckt ein Reader-Thread in den
    nächsten Test."""
    yield
    hub.stop_all()
    time.sleep(0.05)


class GoodProducer(hub.Producer):
    """Liefert `frames` und beendet dann den Stream."""

    def __init__(self, frames):
        self.frames, self.closed = frames, False

    def open(self):
        pass

    def read(self, on_frame):
        for f in self.frames:
            if on_frame(f) is False:
                return
            time.sleep(0.01)

    def close(self):
        self.closed = True


class DeadProducer(hub.Producer):
    """open() klappt, aber es kommt nie ein Bild — Stream endet sofort."""
    default_error = "keine Kamera da"

    def open(self):
        pass

    def read(self, on_frame):
        pass

    def close(self):
        pass


class HangProducer(hub.Producer):
    """read() blockiert ohne Bild → start() muss in den Timeout laufen."""
    default_error = "keine Kamera da (Timeout)"

    def __init__(self):
        self._stop = threading.Event()

    def open(self):
        pass

    def read(self, on_frame):
        self._stop.wait(5)

    def close(self):
        self._stop.set()


class FailOpenProducer(hub.Producer):
    def open(self):
        raise ConnectionError("Port 322 abgelehnt")

    def read(self, on_frame):
        pass

    def close(self):
        pass


class SlowProducer(hub.Producer):
    def __init__(self):
        self.opens = 0

    def open(self):
        self.opens += 1

    def read(self, on_frame):
        for i in range(20):
            if on_frame(b"\xff\xd8" + bytes([i])) is False:
                return
            time.sleep(0.03)

    def close(self):
        pass


def test_zuschauer_bekommt_bilder_und_producer_wird_geschlossen():
    frames = [b"\xff\xd8" + bytes([i]) for i in range(5)]
    prod = GoodProducer(frames)
    key = ("test", "ip1", "c")
    h = hub.get_hub(key, lambda: prod, first_frame_timeout=2.0)
    assert h is not None and not h.dead
    seen = []
    try:
        for f in h.frames_iter():
            seen.append(f)
    except ConnectionError:
        pass        # Stream-Ende → Signal zum Neuverbinden, erwartet
    assert seen and seen[0] == frames[0]
    assert prod.closed
    # Toter Hub darf NICHT in der Registry bleiben, sonst bliebe die Ansicht schwarz.
    assert hub.find_hub(key) is None


def test_stream_endet_ohne_bild():
    key = ("test", "ip2", "c")
    with pytest.raises(ConnectionError) as e:
        hub.get_hub(key, lambda: DeadProducer(), first_frame_timeout=0.5)
    assert "beendet" in str(e.value).lower()
    assert hub.find_hub(key) is None


def test_timeout_meldet_default_error():
    key = ("test", "ip2b", "c")
    with pytest.raises(ConnectionError) as e:
        hub.get_hub(key, lambda: HangProducer(), first_frame_timeout=0.4)
    assert "timeout" in str(e.value).lower()
    assert hub.find_hub(key) is None


def test_open_fehler_nennt_den_echten_grund():
    """„Port 322 abgelehnt" muss beim Nutzer ankommen — daran erkennt er, dass sein
    Drucker das RTSP-Backend gar nicht hat."""
    with pytest.raises(ConnectionError) as e:
        hub.get_hub(("test", "ip3", "c"), lambda: FailOpenProducer(), first_frame_timeout=0.5)
    assert "abgelehnt" in str(e.value)


def test_zwei_zuschauer_teilen_einen_producer():
    sp = SlowProducer()
    key = ("test", "ip4", "c")
    hub.get_hub(key, lambda: sp, first_frame_timeout=2.0)
    counts = {"a": 0, "b": 0}

    def viewer(tag):
        for _ in hub.get_hub(key, lambda: sp, 2.0).frames_iter():
            counts[tag] += 1
            if counts[tag] >= 3:
                break

    ta = threading.Thread(target=viewer, args=("a",))
    tb = threading.Thread(target=viewer, args=("b",))
    ta.start(); tb.start(); ta.join(timeout=5); tb.join(timeout=5)
    assert counts["a"] >= 1 and counts["b"] >= 1
    assert sp.opens == 1        # DAS ist der Sinn des Hubs


def test_stop_all_raeumt_die_registry():
    key = ("test", "ipA", "c")
    hub.get_hub(key, lambda: SlowProducer(), 2.0)
    hub.stop_all()
    time.sleep(0.05)
    assert hub.find_hub(key) is None
