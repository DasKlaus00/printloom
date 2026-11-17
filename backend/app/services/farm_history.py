"""Gemessene Laufzeit je Datei für die ETA aus echten Läufen (Roadmap B.2).

Seit v1.1.79 eigenes Modul (vorher in routers/autofarm.py, wortgleich).
"""
import logging

from app.paths import db_path
from app.services import storage

logger = logging.getLogger(__name__)

PATH = db_path("farm_history.json")
KEEP = 8     # rolling samples per file for the duration average

# farm_history.json: { "<file_id>": {"samples": [min, …], "avg_min": x, "n": k} }
def read() -> dict:
    data = storage.read_json(PATH, {})
    return data if isinstance(data, dict) else {}


def record(file_id, minutes: float, kwh: float = 0.0):
    """Append a measured full-cycle duration (wall-clock running→done, in minutes)
    and energy (kWh) for a file; keep rolling averages over the last KEEP runs."""
    if file_id is None or minutes <= 0:
        return
    try:
        hist = read()
        key  = str(file_id)
        entry = hist.get(key) or {}
        samples = [float(x) for x in entry.get("samples", []) if x] + [round(float(minutes), 1)]
        samples = samples[-KEEP:]
        out = {
            "samples": samples,
            "avg_min": round(sum(samples) / len(samples), 1),
            "n":       len(samples),
        }
        if kwh and kwh > 0:
            ksamples = [float(x) for x in entry.get("kwh_samples", []) if x] + [round(float(kwh), 4)]
            ksamples = ksamples[-KEEP:]
            out["kwh_samples"] = ksamples
            out["avg_kwh"]     = round(sum(ksamples) / len(ksamples), 4)
        elif entry.get("avg_kwh"):
            out["kwh_samples"] = entry.get("kwh_samples", [])
            out["avg_kwh"]     = entry["avg_kwh"]
        hist[key] = out
        storage.write_json(PATH, hist)
    except Exception as e:
        logger.warning(f"history write failed: {e}")
