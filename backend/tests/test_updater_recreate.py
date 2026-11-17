"""Docker-Update-Helfer: nur übernehmen, was der Container selbst gesetzt hat (v1.1.74).

Bis v1.1.73 übernahm recreate() Env, Labels, Cmd und Entrypoint des alten Containers
komplett. Damit trug der neue Container das Versions-Label und die Env des ALTEN
Images, und benannte Volumes aus HostConfig.Mounts (Compose v2) fielen weg.
Die Attrappe hat die Form von docker-py 7.1.0 (attrs wie `docker inspect`).
"""
import pytest

pytest.importorskip("docker")

from app.services import updater                     # noqa: E402

ALT_ID = "sha256:" + "a" * 64
IMAGE_CFG = {
    "Env": ["PATH=/usr/local/bin:/usr/bin", "PRINTLOOM_BUILD=1.1.73"],
    "Labels": {"org.opencontainers.image.version": "1.1.73", "org.opencontainers.image.source": "x"},
    "Cmd": ["uvicorn", "app.main:app"],
    "Entrypoint": None,
}
CONTAINER = {
    "Config": {
        "Image": "ghcr.io/dasklaus00/printloom:beta",
        "Env": IMAGE_CFG["Env"] + ["GITHUB_REPO=DasKlaus00/printloom", "TZ=Europe/Berlin"],
        "Labels": {**IMAGE_CFG["Labels"], "com.docker.compose.project": "printloom"},
        "Cmd": ["uvicorn", "app.main:app"],
        "Entrypoint": None,
        "User": "",
    },
    "HostConfig": {
        "Binds": ["/var/run/docker.sock:/var/run/docker.sock"],
        "Mounts": [
            {"Type": "volume", "Source": "printloom_db", "Target": "/app/db", "VolumeOptions": {}},
            {"Type": "bind", "Source": "/var/run/docker.sock", "Target": "/var/run/docker.sock"},
        ],
        "PortBindings": {"8000/tcp": [{"HostIp": "", "HostPort": "8000"}]},
        "RestartPolicy": {"Name": "unless-stopped"},
        "NetworkMode": "printloom_default",
        "ExtraHosts": ["printer.local:192.0.2.10"],
        "LogConfig": {"Type": "json-file", "Config": {"max-size": "10m"}},
        "Memory": 0,
    },
    "NetworkSettings": {"Networks": {"printloom_default": {}}},
}


class _Img:
    def __init__(self, id_, cfg):
        self.id, self.attrs = id_, {"Config": cfg}


class _Old:
    attrs = CONTAINER
    image = _Img(ALT_ID, IMAGE_CFG)

    def __init__(self):
        self.stopped = self.removed = False

    def stop(self, timeout=None):
        self.stopped = True

    def remove(self, force=False):
        self.removed = True


class _Client:
    def __init__(self, fail_first_run=False):
        self.old = _Old()
        self.runs, self.pulls = [], []
        self.fail_first_run = fail_first_run
        client = self

        class Containers:
            def get(self, name):
                return client.old

            def run(self, **kw):
                client.runs.append(kw)
                if client.fail_first_run and len(client.runs) == 1:
                    raise RuntimeError("port is already allocated")

        class Images:
            def pull(self, image):
                client.pulls.append(image)

            def get(self, id_):
                assert id_ == ALT_ID
                return _Img(ALT_ID, IMAGE_CFG)

        self.containers, self.images = Containers(), Images()


@pytest.fixture
def client(monkeypatch):
    c = _Client()
    monkeypatch.setattr(updater, "_client", lambda: c)
    return c


def test_nur_eigene_env_und_labels(client):
    updater.recreate("ghcr.io/dasklaus00/printloom:beta", "printloom")
    kw = client.runs[0]
    assert kw["image"] == "ghcr.io/dasklaus00/printloom:beta"
    assert kw["environment"] == ["GITHUB_REPO=DasKlaus00/printloom", "TZ=Europe/Berlin"]
    assert "org.opencontainers.image.version" not in kw["labels"]
    assert kw["labels"] == {"com.docker.compose.project": "printloom"}
    # Cmd stammt aus dem Image → das neue Image bringt seinen eigenen mit
    assert "command" not in kw and "entrypoint" not in kw


def test_volumes_netz_und_weitere_einstellungen_bleiben(client):
    updater.recreate("ghcr.io/dasklaus00/printloom:beta", "printloom")
    kw = client.runs[0]
    assert kw["volumes"] == ["/var/run/docker.sock:/var/run/docker.sock"]
    ziele = [(m["Target"], m["Type"], m.get("Source")) for m in kw["mounts"]]
    assert ziele == [("/app/db", "volume", "printloom_db")]   # Bind schon über Binds
    assert kw["network"] == "printloom_default"
    assert kw["ports"] == {"8000/tcp": "8000"}
    assert kw["restart_policy"] == {"Name": "unless-stopped"}
    assert kw["extra_hosts"] == ["printer.local:192.0.2.10"]
    assert kw["log_config"] == {"Type": "json-file", "Config": {"max-size": "10m"}}
    assert "mem_limit" not in kw and "user" not in kw   # nicht gesetzt → Standard


def test_selbst_gesetzter_befehl_bleibt(client, monkeypatch):
    eigener = {**CONTAINER, "Config": {**CONTAINER["Config"], "Cmd": ["uvicorn", "app.main:app", "--workers", "1"]}}
    monkeypatch.setattr(_Old, "attrs", eigener)
    updater.recreate("ghcr.io/dasklaus00/printloom:beta", "printloom")
    assert client.runs[0]["command"] == ["uvicorn", "app.main:app", "--workers", "1"]


def test_rollback_startet_mit_der_alten_image_id(monkeypatch):
    c = _Client(fail_first_run=True)
    monkeypatch.setattr(updater, "_client", lambda: c)
    with pytest.raises(RuntimeError):
        updater.recreate("ghcr.io/dasklaus00/printloom:beta", "printloom")
    assert [r["image"] for r in c.runs] == ["ghcr.io/dasklaus00/printloom:beta", ALT_ID]
    assert c.old.stopped and c.old.removed
