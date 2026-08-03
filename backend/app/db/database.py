import sqlite3
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.paths import DB_DIR

# Datenordner sicherstellen (zentral über app.paths aufgelöst: Docker=/app/db,
# nativ=%APPDATA%/Printloom/db, Dev=backend/db).
DB_DIR.mkdir(parents=True, exist_ok=True)


def _rename_legacy_db():
    """One-time rename of the pre-Printloom database file so existing installs
    keep their data (devices, rack config, sequences, queue, uploads) after the
    rebrand. Runs before the engine connects."""
    new = DB_DIR / "printloom.db"
    old = DB_DIR / "ottomat3d.db"
    if old.exists() and not new.exists():
        for suffix in ("", "-wal", "-shm"):
            o = DB_DIR / f"ottomat3d.db{suffix}"
            if o.exists():
                try:
                    o.rename(DB_DIR / f"printloom.db{suffix}")
                except Exception:
                    pass


_rename_legacy_db()

DATABASE_URL = f"sqlite:///{DB_DIR}/printloom.db"

# Warum die Pool-/PRAGMA-Werte gesetzt sind ("die Seite lädt manchmal ewig"):
#
# 1. POOL. SQLAlchemy 2.0 nimmt für datei-basiertes SQLite einen QueuePool mit
#    Standard 5+10 = 15 Verbindungen und wartet danach 30 s auf eine freie. Uvicorn
#    fährt aber bis zu 40 Threads für synchrone Endpunkte, dazu Hintergrund-Threads
#    (Farm-Runner, Kamera, MQTT). Sobald mehrere langsame Requests gleichzeitig eine
#    Sitzung halten (Datei-Bibliothek: Thumbnail + Crash-Check + quick-meta je Datei),
#    war der Pool leer und JEDER weitere Request stand 30 s — auch /api/health und die
#    ausgelieferten JS-Chunks. Genau das ist das „Seite lädt nicht"-Bild. Mehr
#    Verbindungen kosten bei SQLite fast nichts (ein Dateihandle), und ein kurzer
#    pool_timeout meldet einen echten Stau als Fehler, statt ihn 30 s zu verstecken.
# 2. WAL. Im Standard-Journal (delete) sperrt EIN Schreiber ALLE Leser. Mit WAL lesen
#    und schreiben parallel — bei einer App, die im Sekundentakt Status schreibt und
#    gleichzeitig überall liest, ist das der Unterschied zwischen flüssig und hakelig.
# 3. busy_timeout. Ohne ihn wirft SQLite bei einer belegten Sperre SOFORT
#    „database is locked" statt kurz zu warten.
engine = create_engine(
    DATABASE_URL,
    # timeout = wie lange SQLite selbst auf eine Sperre wartet (Sekunden).
    connect_args={"check_same_thread": False, "timeout": 15},
    pool_size=20, max_overflow=40, pool_timeout=10, pool_pre_ping=True,
)


@event.listens_for(engine, "connect")
def _sqlite_pragmas(dbapi_conn, _record):
    """WAL + Wartezeit je NEUER Verbindung setzen (PRAGMAs gelten pro Verbindung).
    journal_mode ist persistent in der Datei, wird aber bewusst jedes Mal gesetzt —
    so gilt es auch für eine frisch angelegte Datenbank."""
    cur = dbapi_conn.cursor()
    try:
        cur.execute("PRAGMA journal_mode=WAL")
        cur.execute("PRAGMA busy_timeout=15000")
        # NORMAL statt FULL: unter WAL sicher gegen App-Abstürze (nur ein
        # Stromausfall im falschen Moment kostet die letzten Transaktionen) und
        # spürbar weniger fsync-Last auf SD-Karten/USB-Sticks.
        cur.execute("PRAGMA synchronous=NORMAL")
    except Exception:
        pass          # ältere/eingeschränkte SQLite-Builds: Standardverhalten reicht
    finally:
        cur.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def _migrate():
    """Lightweight schema migration: add new columns to existing tables.
    SQLAlchemy's create_all() never ALTERs existing tables, so columns added to
    a model after a DB already exists must be added by hand."""
    db_path = DB_DIR / "printloom.db"
    if not db_path.exists():
        return
    con = sqlite3.connect(str(db_path))
    try:
        cur = con.cursor()
        cur.execute("PRAGMA table_info(uploaded_files)")
        cols = {r[1] for r in cur.fetchall()}
        adds = {
            "folder_id":   "INTEGER",
            "part_number": "VARCHAR(120)",
            "tags":        "VARCHAR(512)",
            "material":    "VARCHAR(80)",
            "color":       "VARCHAR(32)",
        }
        for name, typ in adds.items():
            if name not in cols:
                cur.execute(f"ALTER TABLE uploaded_files ADD COLUMN {name} {typ}")
        # Drucker-Modell (seit v1.0.162). Für vorhandene Bambu-Geräte einmalig aus der
        # Seriennummer vorbelegt, damit die Kamera nicht weiter proben muss. Nur als
        # Vorschlag: der Nutzer kann das Modell im Geräte-Formular korrigieren.
        cur.execute("PRAGMA table_info(devices)")
        dev_cols = {r[1] for r in cur.fetchall()}
        if "model" not in dev_cols:
            cur.execute("ALTER TABLE devices ADD COLUMN model VARCHAR(64)")
            from app.services import printer_models
            cur.execute("SELECT id, serial_number FROM devices")
            for dev_id, serial in cur.fetchall():
                guess = printer_models.from_serial(serial)
                if guess:
                    cur.execute("UPDATE devices SET model = ? WHERE id = ?", (guess, dev_id))
        con.commit()
    except Exception:
        pass
    finally:
        con.close()

def init_db():
    from app.models.models import Base
    Base.metadata.create_all(bind=engine)
    _migrate()
