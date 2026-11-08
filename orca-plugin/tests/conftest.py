"""Test-Umgebung für das OrcaSlicer-Plugin — ohne OrcaSlicer.

Das `orca`-Modul steckt in Orcas Programmdatei. Hier steht ein Ersatz mit genau den
Teilen der API, die das Plugin benutzt (Namen und Signaturen aus der Orca-Doku,
developer_reference/plugin_development/api_reference). Statt Printloom antwortet ein
echter kleiner HTTP-Server, damit der urllib-Weg (Basic-Auth, gzip, Upload in
Stücken) wirklich durchlaufen wird.
"""
import enum
import gzip
import importlib.util
import json
import sys
import threading
import types
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

PLUGIN = Path(__file__).resolve().parents[1] / "printloom_orca.py"


def _fake_orca(storage_dir: str, lang: str = "de_DE"):
    orca = types.ModuleType("orca")
    orca.registered, orca.permissions, orca.notifications = [], {}, []

    class PythonPluginBase:
        def __init__(self):
            pass

    class base:
        pass

    class LifecycleEvent(enum.Enum):
        SliceStarted = 1
        GCodeExportStarted = 2
        GCodeExportFinished = 3
        SlicingJobComplete = 4

    class LifecycleEvtCode(enum.Enum):
        Ok = 0
        Error = 1
        Warn = 2

    orca.PythonPluginBase, orca.base = PythonPluginBase, base
    orca.LifecycleEvent, orca.LifecycleEvtCode = LifecycleEvent, LifecycleEvtCode
    orca.plugin = lambda cls: cls
    orca.register_capability = orca.registered.append
    orca.request_permissions = lambda **kw: orca.permissions.update(kw)

    pages = types.ModuleType("orca.pages")

    class PagesPluginCapabilityBase(PythonPluginBase):
        def post_message(self, data):
            self.__dict__.setdefault("posted", []).append(json.loads(json.dumps(data)))

    pages.PagesPluginCapabilityBase = PagesPluginCapabilityBase

    agent = types.ModuleType("orca.printer_agent")

    class PrinterAgentBase(PythonPluginBase):
        pass

    class AgentInfo:
        def __init__(self, id="", name="", version="", description=""):
            self.id, self.name, self.version, self.description = id, name, version, description

    class FilamentSyncMode(enum.Enum):
        None_ = 0
        Subscription = 1
        Pull = 2

    class CameraStreamMode(enum.Enum):
        None_ = 0
        HTTP = 1

    agent.PrinterAgentBase, agent.AgentInfo = PrinterAgentBase, AgentInfo
    agent.FilamentSyncMode, agent.CameraStreamMode = FilamentSyncMode, CameraStreamMode

    host = types.ModuleType("orca.host")
    host.plugin = types.SimpleNamespace(storage=lambda: storage_dir)
    host.app_language = lambda: lang
    host.ui = types.SimpleNamespace(
        NotificationLevel=types.SimpleNamespace(WarningNotificationLevel="warning",
                                                HintNotificationLevel="hint",
                                                RegularNotificationLevel="regular"),
        push_notification=lambda level, text, **kw: orca.notifications.append((level, text)))

    orca.pages, orca.printer_agent, orca.host = pages, agent, host
    return orca


@pytest.fixture
def plugin(tmp_path, monkeypatch):
    """Das Plugin frisch geladen — jeder Test mit eigenem Kern-Zustand."""
    orca = _fake_orca(str(tmp_path))
    monkeypatch.setitem(sys.modules, "orca", orca)
    spec = importlib.util.spec_from_file_location("printloom_orca_under_test", PLUGIN)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    mod.orca_fake = orca
    yield mod
    while mod.CORE.users:
        mod.CORE.stop()


class FakePrintloom:
    """Antwortet wie /api/slicer/…; merkt sich jede Anfrage."""

    def __init__(self):
        self.requests = []
        self.info = {"api": 1, "version": "1.1.40",
                     "printers": [{"id": 1, "name": "X1C", "model": "x1c", "dev_model": "BL-P001"}],
                     "limits": {}}
        self.check = {"plate": None,
                      "crash": {"crash_risk": True, "hit_x_mm": 5.0, "hit_z_mm": 40.0,
                                "z_limit_mm": 30.0, "x_margin_mm": 10.0, "x_max_mm": 256.0},
                      "height": {"height_mm": 69.0, "ok": True, "slots_needed": 1,
                                 "max_height_mm": 275.0},
                      "spool": {"state": "ok", "items": []}}
        self.state = {"connected": True, "device": {"id": 1, "dev_model": "BL-P001"},
                      "print": {"gcode_state": "RUNNING", "mc_percent": 42,
                                "ams": {"ams": [{"id": "0", "tray": []}]}}}
        self.html_login = False
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def _reply(self, code, payload, ctype="application/json"):
                body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
                self.send_response(code)
                self.send_header("Content-Type", ctype)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def _route(self, method):
                url = urllib.parse.urlparse(self.path)
                length = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(length) if length else b""
                if self.headers.get("Content-Encoding") == "gzip":
                    body = gzip.decompress(body)
                fake.requests.append({"method": method, "path": url.path,
                                      "query": dict(urllib.parse.parse_qsl(url.query)),
                                      "auth": self.headers.get("Authorization"),
                                      "body": body})
                if fake.html_login:
                    return self._reply(200, b"<html>authentik login</html>", "text/html")
                if url.path == "/api/slicer/info":
                    return self._reply(200, fake.info)
                if url.path == "/api/slicer/check":
                    return self._reply(200, fake.check)
                if url.path == "/api/slicer/upload":
                    q = dict(urllib.parse.parse_qsl(url.query))
                    jobs = [3] if q.get("queue") == "true" else []
                    return self._reply(200, {"file_id": 9, "file_name": q.get("filename"),
                                             "queued": bool(jobs), "job_ids": jobs,
                                             "checks": [fake.check]})
                if url.path == "/api/slicer/printer/state":
                    return self._reply(200, fake.state)
                if url.path == "/api/slicer/overview":
                    return self._reply(200, {"farm": {"running": True}, "jobs": {}, "rack": {},
                                             "printer": None, "ams": []})
                return self._reply(404, {"detail": "Not Found"})

            def do_GET(self):
                self._route("GET")

            def do_POST(self):
                self._route("POST")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, kwargs={"poll_interval": 0.05},
                         daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def printloom():
    fake = FakePrintloom()
    yield fake
    fake.close()
