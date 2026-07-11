"""Lädt eine statische ffmpeg.exe (Windows) nach desktop/vendor/ffmpeg.exe.

Wird als Build-Schritt VOR PyInstaller ausgeführt, damit die native App die
X1C-Kamera (RTSPS→MJPEG) ohne System-ffmpeg kann. Ist bereits eine ffmpeg.exe
vorhanden, wird nichts erneut geladen. Schlägt der Download fehl, ist das kein
harter Fehler — die App fällt dann auf ein ffmpeg im System-PATH zurück.
"""
from __future__ import annotations

import io
import sys
import zipfile
from pathlib import Path
from urllib.request import urlopen, Request

VENDOR = Path(__file__).resolve().parent / "vendor"
TARGET = VENDOR / "ffmpeg.exe"

# BtbN stellt kompakte win64-Builds als GitHub-Release-Asset bereit.
URL = ("https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/"
       "ffmpeg-master-latest-win64-gpl.zip")


def main() -> int:
    if TARGET.is_file() and TARGET.stat().st_size > 1_000_000:
        print(f"ffmpeg bereits vorhanden: {TARGET}")
        return 0
    VENDOR.mkdir(parents=True, exist_ok=True)
    print(f"Lade ffmpeg … ({URL})")
    try:
        req = Request(URL, headers={"User-Agent": "printloom-build"})
        with urlopen(req, timeout=120) as r:
            data = r.read()
    except Exception as e:
        print(f"FEHLER: Download fehlgeschlagen: {e}", file=sys.stderr)
        return 1
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        name = next(n for n in zf.namelist() if n.endswith("/bin/ffmpeg.exe"))
        with zf.open(name) as src, open(TARGET, "wb") as out:
            out.write(src.read())
    except Exception as e:
        print(f"FEHLER: Entpacken fehlgeschlagen: {e}", file=sys.stderr)
        return 1
    print(f"ffmpeg.exe geschrieben: {TARGET} ({TARGET.stat().st_size // 1_000_000} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
