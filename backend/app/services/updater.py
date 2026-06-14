"""Self-update / channel-switch via the Docker socket.

The app container can switch between the `latest` (stable) and `beta` image tags
and pull the newest build of the active channel — all from the web UI. Because a
container can't cleanly recreate *itself* (its process dies mid-operation), the
actual recreate runs in a short-lived **helper** container started from the same
image with the Docker socket mounted (see `spawn_helper`). The helper clones the
running container's config (volumes, ports, env, network, restart policy, the
docker.sock mount) and re-creates it with the target image, then exits (`--rm`).

Requires `/var/run/docker.sock` mounted into the container.
"""
import sys
import time
import logging

logger = logging.getLogger(__name__)

HELPER_NAME = "printloom-updater"
SOCK_BIND = "/var/run/docker.sock:/var/run/docker.sock"


def _client():
    import docker
    return docker.from_env()


def docker_available() -> bool:
    """True if the Docker socket is reachable (channel switching possible)."""
    try:
        c = _client()
        c.ping()
        return True
    except Exception as e:
        logger.info(f"Docker-Socket nicht verfügbar: {e}")
        return False


def pull_image(image: str) -> tuple[bool, str]:
    """Pull `image` via the daemon (shared image store). Returns (ok, message).

    Done from the APP container *before* spawning the helper so a failed pull
    (private package, wrong tag, no network) surfaces immediately as a real error
    instead of a detached helper dying silently — the classic "updates forever,
    does nothing" symptom."""
    try:
        _client().images.pull(image)
        return True, "ok"
    except Exception as e:
        msg = str(e)
        low = msg.lower()
        if "unauthorized" in low or "denied" in low or "forbidden" in low:
            hint = ("Image konnte nicht gezogen werden (kein Zugriff). Ist das "
                    "ghcr-Package öffentlich? Sonst GITHUB_TOKEN mit 'read:packages' setzen.")
        elif "not found" in low or "manifest unknown" in low:
            hint = f"Image/Tag nicht gefunden: {image}"
        else:
            hint = f"Pull fehlgeschlagen: {msg[:200]}"
        logger.error(f"pull_image({image}) → {msg}")
        return False, hint


def current_image(name: str) -> str | None:
    """Image reference the named container currently runs."""
    try:
        return _client().containers.get(name).attrs["Config"]["Image"]
    except Exception:
        return None


def running_repo_digest(name: str, repo: str) -> str | None:
    """sha256 digest of the running image for `repo` (e.g. ghcr.io/owner/printloom)."""
    try:
        img = _client().containers.get(name).image
        for rd in img.attrs.get("RepoDigests", []) or []:
            if rd.startswith(repo + "@"):
                return rd.split("@", 1)[1]
    except Exception:
        pass
    return None


def spawn_helper(target_image: str, container_name: str) -> None:
    """Start a detached helper that recreates `container_name` onto `target_image`.

    Runs from the current app image (which ships this module) so no extra image is
    needed. Returns immediately; the API can answer the request before it's killed.
    """
    client = _client()
    self_image = client.containers.get(container_name).attrs["Config"]["Image"]
    # Remove a stale helper from a previous run, if any.
    try:
        old = client.containers.get(HELPER_NAME)
        old.remove(force=True)
    except Exception:
        pass
    client.containers.run(
        self_image,
        name=HELPER_NAME,
        command=["python", "-m", "app.services.updater", target_image, container_name],
        volumes=[SOCK_BIND],
        detach=True,
        remove=True,
    )
    logger.info(f"Update-Helfer gestartet: {target_image} → {container_name}")


def recreate(new_image: str, name: str) -> None:
    """Pull `new_image` and recreate container `name` with the same config.
    Intended to run INSIDE the helper container."""
    client = _client()
    logger.info(f"Ziehe Image {new_image} …")
    client.images.pull(new_image)

    old = client.containers.get(name)
    info = old.attrs
    cfg = info.get("Config", {})
    hostcfg = info.get("HostConfig", {})
    nets = info.get("NetworkSettings", {}).get("Networks", {}) or {}

    # ports: {"8000/tcp": [{"HostIp":"", "HostPort":"8000"}]} → {"8000/tcp": "8000"}
    ports = {}
    for cport, binds in (hostcfg.get("PortBindings") or {}).items():
        if binds:
            hp = binds[0].get("HostPort")
            hip = binds[0].get("HostIp") or ""
            ports[cport] = (hip, hp) if hip else hp

    restart = hostcfg.get("RestartPolicy") or {}
    network_mode = hostcfg.get("NetworkMode")
    # Pick a named network to attach to (NetworkMode is often the network name).
    network = network_mode if network_mode and not network_mode.startswith(("bridge", "host", "none", "container:", "default")) else None
    if not network and nets:
        network = next(iter(nets.keys()))

    run_kwargs = dict(
        image=new_image,
        name=name,
        detach=True,
        environment=cfg.get("Env"),
        labels=cfg.get("Labels") or {},
        volumes=hostcfg.get("Binds") or [],
        ports=ports or None,
        restart_policy={"Name": restart.get("Name")} if restart.get("Name") else None,
        healthcheck=None,  # inherited from the image
    )
    if network:
        run_kwargs["network"] = network
    if cfg.get("Entrypoint"):
        run_kwargs["entrypoint"] = cfg.get("Entrypoint")
    if cfg.get("Cmd"):
        run_kwargs["command"] = cfg.get("Cmd")
    run_kwargs = {k: v for k, v in run_kwargs.items() if v is not None}

    old_image = cfg.get("Image")  # für Rollback, falls der neue Container nicht startet

    logger.info(f"Stoppe & entferne alten Container {name} …")
    try:
        old.stop(timeout=20)
    except Exception:
        pass
    old.remove(force=True)

    logger.info(f"Starte neuen Container {name} aus {new_image} …")
    try:
        client.containers.run(**run_kwargs)
    except Exception as e:
        # Neuer Container startet nicht → App wäre offline. Auf altes Image
        # zurückrollen, damit der Dienst wieder läuft, dann den Fehler melden.
        logger.error(f"Neuer Container startete nicht ({e}) — Rollback auf {old_image}")
        run_kwargs["image"] = old_image
        client.containers.run(**run_kwargs)
        raise
    logger.info("Recreate abgeschlossen.")


if __name__ == "__main__":
    # Helper entrypoint: python -m app.services.updater <image> <container_name>
    if len(sys.argv) < 3:
        print("usage: updater.py <image> <container_name>", file=sys.stderr)
        sys.exit(2)
    image, cname = sys.argv[1], sys.argv[2]
    # Give the API a moment to answer the triggering request before we kill it.
    time.sleep(3)
    try:
        recreate(image, cname)
    except Exception as e:
        logging.basicConfig(level=logging.INFO)
        logger.error(f"Update fehlgeschlagen: {e}")
        sys.exit(1)
