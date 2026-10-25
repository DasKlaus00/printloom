"""Die Tests dürfen den echten Datenordner nicht anfassen.

backend/db/ ist im Dev-Checkout derselbe Ordner, den docker-compose als /app/db
einhängt. Schrieben die Tests dort hinein, stünden erfundene Notaus- und
Stresstest-Zeilen im Farm-Log der echten Anlage (so bis v1.1.37). conftest.py
lenkt deshalb PRINTLOOM_DATA_DIR auf einen Temp-Ordner — dieser Test hält fest,
dass das greift."""
from pathlib import Path

from app import paths


def test_datenordner_liegt_nicht_im_repo():
    backend = Path(__file__).resolve().parent.parent
    for ordner in (paths.DB_DIR, paths.UPLOADS_DIR):
        assert backend not in Path(ordner).resolve().parents, \
            f"{ordner} liegt im Repo — Tests würden echte Daten überschreiben"
