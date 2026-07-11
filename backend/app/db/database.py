import sqlite3
from sqlalchemy import create_engine
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

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
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
        con.commit()
    except Exception:
        pass
    finally:
        con.close()

def init_db():
    from app.models.models import Base
    Base.metadata.create_all(bind=engine)
    _migrate()
