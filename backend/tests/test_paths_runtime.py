"""Laufzeit-Erkennung (app/paths.py).

Auf Windows prüft os.path.exists("/app") den Ordner C:\\app. Gab es den, hielt sich die
Windows-App bis v1.1.41 für Docker: Daten nach C:\\app\\db, kein Frontend, Docker-Update.
RUNTIME wird beim Import berechnet, darum ruft der Test _resolve_runtime() direkt auf.
"""
import pytest

from app import paths


@pytest.fixture
def lage(monkeypatch):
    monkeypatch.delenv("PRINTLOOM_RUNTIME", raising=False)

    def setze(platform, app_ordner, frozen):
        monkeypatch.setattr(paths.sys, "platform", platform)
        monkeypatch.setattr(paths.os.path, "exists", lambda p: app_ordner and p == "/app")
        monkeypatch.setattr(paths, "_is_frozen", lambda: frozen)
    return setze


def test_windows_app_mit_c_app_ordner_bleibt_nativ(lage):
    lage("win32", True, True)
    assert paths._resolve_runtime() == "native"


def test_windows_checkout_mit_c_app_ordner_ist_dev(lage):
    lage("win32", True, False)
    assert paths._resolve_runtime() == "dev"


def test_linux_mit_app_ordner_ist_docker(lage):
    lage("linux", True, False)
    assert paths._resolve_runtime() == "docker"


def test_ohne_app_ordner_ist_dev(lage):
    lage("linux", False, False)
    assert paths._resolve_runtime() == "dev"


def test_variable_gewinnt_immer(lage, monkeypatch):
    lage("win32", True, True)
    monkeypatch.setenv("PRINTLOOM_RUNTIME", "Native-Linux")
    assert paths._resolve_runtime() == "native-linux"
