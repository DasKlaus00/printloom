# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller-Spec für die native Printloom-Desktop-App (Windows).

Bündelt das FastAPI-Backend (app-Paket), das gebaute Frontend (frontend/dist),
version.txt, das Tray-Icon und — falls vorhanden — eine gebündelte ffmpeg.exe
(für die X1C-Kamera). Build:

    .venv-build/Scripts/python.exe desktop/fetch_ffmpeg.py        # optional, einmal
    .venv-build/Scripts/pyinstaller desktop/printloom.spec --noconfirm

Ergebnis: dist/Printloom/Printloom.exe (One-Folder — schnellerer Start als One-File).
"""
import os
import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

ROOT = Path(os.getcwd())
BACKEND = ROOT / "backend"
DESKTOP = ROOT / "desktop"
FRONTEND_DIST = ROOT / "frontend" / "dist"

# app-Paket + desktop-Module während der Analyse auffindbar machen.
for _p in (str(BACKEND), str(DESKTOP)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

# ── Ressourcen (datas) ────────────────────────────────────────────────────────
datas = []
datas += [(str(FRONTEND_DIST), "frontend/dist")]
datas += [(str(BACKEND / "version.txt"), ".")]
datas += [(str(DESKTOP / "icon.png"), "."), (str(DESKTOP / "icon.ico"), ".")]
# tzdata (zoneinfo-DB für Betriebszeiten) mitliefern.
datas += collect_data_files("tzdata")
# Gebündelte ffmpeg.exe, falls von fetch_ffmpeg.py bereitgestellt.
_ffmpeg = DESKTOP / "vendor" / "ffmpeg.exe"
if _ffmpeg.is_file():
    datas += [(str(_ffmpeg), ".")]

# ── Dynamisch/lazy importierte Module sichern ─────────────────────────────────
hiddenimports = []
hiddenimports += collect_submodules("app")        # alle Router/Services (auch lazy)
hiddenimports += collect_submodules("uvicorn")    # loops/protocols/lifespan
hiddenimports += collect_submodules("websockets")
hiddenimports += [
    "paho.mqtt.client",
    "pywebpush",
    "pystray._win32",
    "PIL.Image", "PIL.ImageDraw", "PIL.ImageFont",
]

block_cipher = None

a = Analysis(
    [str(DESKTOP / "printloom_desktop.py")],
    pathex=[str(BACKEND), str(DESKTOP)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["docker", "tkinter"],   # docker-SDK nur für Container-Update-Pfad
    cipher=block_cipher,
    noarchive=False,
)
pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

# One-File: ALLES (Backend, Frontend, ffmpeg, tzdata) in EINER Printloom.exe.
# Beim Start entpackt der Bootloader in einen Temp-Ordner (dadurch etwas längerer
# Kaltstart wegen der gebündelten ffmpeg.exe) — dafür nur eine Datei zum Weitergeben.
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="Printloom",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    runtime_tmpdir=None,
    console=False,                   # Fenster-los (Tray-App)
    icon=str(DESKTOP / "icon.ico"),
)
