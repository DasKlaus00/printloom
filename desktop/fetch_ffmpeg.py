"""Lädt eine statische ffmpeg.exe (Windows) nach desktop/vendor/ffmpeg.exe.

Wird als Build-Schritt VOR PyInstaller ausgeführt, damit die native App die
X1C-Kamera (RTSPS→MJPEG) ohne System-ffmpeg kann. Liegt schon eine ffmpeg.exe
DIESER Version da (vendor/ffmpeg.version), wird nichts geladen. Schlägt Download
oder Prüfsumme fehl, bricht der Build ab (build_windows.ps1) — ein ungeprüftes
ffmpeg kommt nicht in den Installer.
"""
from __future__ import annotations

import hashlib
import io
import sys
import zipfile
from pathlib import Path
from urllib.request import urlopen, Request

VENDOR = Path(__file__).resolve().parent / "vendor"
TARGET = VENDOR / "ffmpeg.exe"
MARKER = VENDOR / "ffmpeg.version"

# Feste Version mit Prüfsumme (seit v1.1.75). Bis v1.1.74 „latest" von BtbN: Jeder
# Build konnte ein anderes, ungeprüftes ffmpeg einpacken, und BtbN räumt alte
# Builds weg. GyanD veröffentlicht nummerierte Releases, die stehen bleiben. Die
# Prüfsumme meldet GitHub selbst (Asset-Feld „digest"); sie wurde beim Umstellen
# nachgerechnet. Der Build enthält gnutls (TLS) und den RTSP-Demuxer — beides
# braucht die X1C-Kamera (RTSPS). Neue Version: VERSION und SHA256 zusammen ändern.
VERSION = "9.0.2"
URL = (f"https://github.com/GyanD/codexffmpeg/releases/download/{VERSION}/"
       f"ffmpeg-{VERSION}-essentials_build.zip")
SHA256 = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba"


def main() -> int:
    have = MARKER.read_text(encoding="utf-8").strip() if MARKER.is_file() else ""
    if TARGET.is_file() and TARGET.stat().st_size > 1_000_000 and have == VERSION:
        print(f"ffmpeg {VERSION} bereits vorhanden: {TARGET}")
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
    got = hashlib.sha256(data).hexdigest()
    if got != SHA256:
        print(f"FEHLER: Prüfsumme stimmt nicht ({got} statt {SHA256}) — nichts entpackt.",
              file=sys.stderr)
        return 1
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
        name = next(n for n in zf.namelist() if n.endswith("/bin/ffmpeg.exe"))
        with zf.open(name) as src, open(TARGET, "wb") as out:
            out.write(src.read())
    except Exception as e:
        print(f"FEHLER: Entpacken fehlgeschlagen: {e}", file=sys.stderr)
        return 1
    MARKER.write_text(VERSION, encoding="utf-8")
    print(f"ffmpeg.exe {VERSION} geschrieben: {TARGET} ({TARGET.stat().st_size // 1_000_000} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
