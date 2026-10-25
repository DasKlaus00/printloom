"""Schema-Migration: neue Spalten in einer BESTEHENDEN Datenbank.

SQLAlchemys create_all() ändert vorhandene Tabellen nie — neue Spalten müssen per
ALTER TABLE nachgezogen werden. Geht das schief, startet die App beim Nutzer mit
„no such column" und nichts geht mehr. Deshalb hier gegen eine echte SQLite-Datei
im Alt-Zustand geprüft."""
import sqlite3

import pytest

pytest.importorskip("sqlalchemy")

from app.db import database  # noqa: E402


def _alte_db(path):
    """Datenbank im Zustand VOR der Modell-Spalte anlegen."""
    con = sqlite3.connect(str(path))
    con.execute("""CREATE TABLE devices (
        id INTEGER PRIMARY KEY, name VARCHAR(255), device_type VARCHAR(20),
        ip_address VARCHAR(255), port INTEGER, serial_number VARCHAR(255),
        access_code VARCHAR(255), mqtt_port INTEGER, use_tls BOOLEAN,
        created_at DATETIME, updated_at DATETIME, is_active BOOLEAN)""")
    con.execute("""CREATE TABLE uploaded_files (
        id INTEGER PRIMARY KEY, filename VARCHAR(255))""")
    con.executemany("INSERT INTO devices (id, name, serial_number) VALUES (?, ?, ?)", [
        (1, "X1C", "00M09A123456"),
        (2, "P1S", "01S00C654321"),
        (3, "OTTOeject", None),
        (4, "Fremd", "ZZZ999"),
    ])
    con.commit()
    con.close()


def _spalten(path, table):
    con = sqlite3.connect(str(path))
    try:
        return {r[1] for r in con.execute(f"PRAGMA table_info({table})")}
    finally:
        con.close()


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DB_DIR", tmp_path)
    p = tmp_path / "printloom.db"
    _alte_db(p)
    return p


def test_modell_spalte_wird_ergaenzt(db):
    assert "model" not in _spalten(db, "devices")
    database._migrate()
    assert "model" in _spalten(db, "devices")


def test_modell_wird_aus_der_seriennummer_vorbelegt(db):
    """Bestandsgeräte sollen nicht weiter die Kamera raten müssen."""
    database._migrate()
    con = sqlite3.connect(str(db))
    try:
        rows = dict(con.execute("SELECT id, model FROM devices"))
    finally:
        con.close()
    assert rows[1] == "x1c"
    assert rows[2] == "p1s"
    assert rows[3] is None      # OTTOeject hat kein Drucker-Modell
    assert rows[4] is None      # unbekanntes Präfix → lieber leer als falsch


def test_migration_ist_wiederholbar(db):
    """Sie läuft bei JEDEM Start — der zweite Durchgang darf nichts kaputt machen."""
    database._migrate()
    con = sqlite3.connect(str(db))
    con.execute("UPDATE devices SET model = 'p1p' WHERE id = 1")
    con.commit()
    con.close()
    database._migrate()
    con = sqlite3.connect(str(db))
    try:
        # Vom Nutzer korrigiertes Modell darf NICHT wieder überschrieben werden.
        assert con.execute("SELECT model FROM devices WHERE id = 1").fetchone()[0] == "p1p"
    finally:
        con.close()


def test_ohne_datenbank_passiert_nichts(tmp_path, monkeypatch):
    """Neuinstallation: create_all() legt alles an, _migrate() darf nicht stören."""
    monkeypatch.setattr(database, "DB_DIR", tmp_path)
    database._migrate()             # kein Crash, kein Datei-Anlegen
    assert not (tmp_path / "printloom.db").exists()


def test_teile_spalten_werden_weiter_ergaenzt(db):
    """Die ältere Migration (Teile-Bibliothek) muss weiter greifen."""
    database._migrate()
    cols = _spalten(db, "uploaded_files")
    assert {"folder_id", "part_number", "tags", "material", "color"} <= cols
