"""Sprache der Oberfläche für die ganze Installation (seit v1.1.91).

Bis v1.1.90 stand die Wahl nur im Browser: neue Adresse (Windows-App auf anderem Port),
anderer Browser oder gelöschte Website-Daten — und alles war wieder deutsch. Jetzt
speichert der Server Sprache und aktivierte Sprachpakete; das Backup nimmt sie mit.
"""
import asyncio

import pytest

pytest.importorskip("fastapi")

from fastapi import HTTPException  # noqa: E402

from app.routers import system  # noqa: E402
from app.services import appsettings  # noqa: E402


@pytest.fixture
def datei(monkeypatch, tmp_path):
    p = tmp_path / "ui_language.json"
    monkeypatch.setattr(appsettings, "_ui_language_file", lambda: str(p))
    return p


def test_ohne_wahl_ist_nichts_gesetzt(datei):
    assert asyncio.run(system.get_ui_language()) == {"language": None, "active": None}


def test_wahl_bleibt_und_wird_vereinheitlicht(datei):
    r = asyncio.run(system.put_ui_language(system.UiLanguageIn(language="zh-CN")))
    assert r["language"] == "zh-cn"
    r = asyncio.run(system.put_ui_language(system.UiLanguageIn(active=["de", "EN", "zh_CN", "en"])))
    assert r == {"language": "zh-cn", "active": ["de", "en", "zh-cn"]}     # Sprache bleibt
    assert asyncio.run(system.get_ui_language()) == r                       # aus der Datei


@pytest.mark.parametrize("body", [{"language": "<script>"}, {"language": "deutsch-sprache-lang"},
                                  {"active": ["de", "../x"]}])
def test_unsinn_wird_abgelehnt(datei, body):
    with pytest.raises(HTTPException) as e:
        asyncio.run(system.put_ui_language(system.UiLanguageIn(**body)))
    assert e.value.status_code == 400
    assert not datei.exists()                                               # nichts geschrieben


def test_keine_liste_lehnt_schon_das_modell_ab():
    from pydantic import ValidationError
    with pytest.raises(ValidationError):                                    # → HTTP 422
        system.UiLanguageIn(active="de")


def test_kaputte_datei_heisst_keine_wahl(datei):
    datei.write_text('{"language": 5, "active": "x"}', encoding="utf-8")
    assert appsettings.read_ui_language() == {"language": None, "active": None}


def test_backup_nimmt_die_sprache_mit():
    keys = [k for _, k in system._backup_files()]
    assert "ui_language" in keys
    assert "ui_language" in system._data_file_rules()
