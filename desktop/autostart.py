"""Windows-Autostart über den Registry-Run-Key (HKCU).

Trägt/Entfernt Printloom in ``HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run``,
sodass die App beim Login des Nutzers im Hintergrund startet. Nur Windows; auf
anderen Plattformen sind die Funktionen No-ops (macOS-LaunchAgent käme später).
"""
from __future__ import annotations

import sys

_RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
_VALUE = "Printloom"


def _launch_command() -> str:
    """Kommando, das den Autostart ausführt (die installierte EXE bzw. im Dev der
    Python-Interpreter + dieses Skript)."""
    if getattr(sys, "frozen", False):
        return f'"{sys.executable}"'
    return f'"{sys.executable}" "{sys.argv[0]}"'


def is_enabled() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as k:
            winreg.QueryValueEx(k, _VALUE)
        return True
    except FileNotFoundError:
        return False
    except OSError:
        return False


def enable() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg
        with winreg.CreateKey(winreg.HKEY_CURRENT_USER, _RUN_KEY) as k:
            winreg.SetValueEx(k, _VALUE, 0, winreg.REG_SZ, _launch_command())
        return True
    except OSError:
        return False


def disable() -> bool:
    if sys.platform != "win32":
        return False
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, _RUN_KEY, 0, winreg.KEY_SET_VALUE) as k:
            winreg.DeleteValue(k, _VALUE)
        return True
    except FileNotFoundError:
        return True
    except OSError:
        return False


def toggle() -> bool:
    """Autostart umschalten; gibt den NEUEN Zustand zurück."""
    if is_enabled():
        disable()
        return False
    enable()
    return True
