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


_docker_missing_logged = False


def docker_available() -> bool:
    """True if the Docker socket is reachable (channel switching possible)."""
    try:
        c = _client()
        c.ping()
        return True
    except Exception as e:
        global _docker_missing_logged
        if not _docker_missing_logged:
            _docker_missing_logged = True
            logger.info(f"Docker socket not available (logged once): {e}")
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
            # Gezogen wird vom Docker-Dienst des Hosts mit dessen Anmeldung — ein
            # GITHUB_TOKEN im Container hilft hier nicht (bis v1.1.73 stand das so da).
            hint = ("Image konnte nicht gezogen werden (kein Zugriff). Ist das "
                    "ghcr-Package öffentlich? Bei einem privaten Fork auf dem Host "
                    "einmal `docker login ghcr.io` ausführen.")
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
    logger.info(f"Update helper started: {target_image} → {container_name}")


def _own_env(container_env, image_env) -> list:
    """Nur die Env-Einträge, die der Container selbst gesetzt hat. Was wörtlich so im
    alten Image steht, kommt aus dem Image — das neue Image bringt seine eigenen
    Werte mit. Bis v1.1.73 wurde die ganze Env übernommen und fror damit z. B. PATH
    oder Versions-Variablen des alten Images im neuen Container ein."""
    base = set(image_env or [])
    return [e for e in (container_env or []) if e not in base]


def _own_labels(container_labels, image_labels) -> dict:
    """Labels, die nicht (gleich) aus dem alten Image stammen. Sonst trüge der neue
    Container das alte org.opencontainers.image.version — die App zeigte die alte
    Version als installiert."""
    base = image_labels or {}
    return {k: v for k, v in (container_labels or {}).items() if base.get(k) != v}


def _mount_args(hostcfg: dict) -> list:
    """HostConfig.Mounts als docker.types.Mount. Compose v2 legt benannte Volumes
    hier ab statt in Binds — ohne diese Übernahme startete der neue Container ohne
    sein Daten-Volume. Ziele, die schon über Binds kommen, werden ausgelassen."""
    from docker.types import Mount
    bound = {b.split(":")[1] for b in (hostcfg.get("Binds") or []) if b.count(":") >= 1}
    out = []
    for m in hostcfg.get("Mounts") or []:
        target = m.get("Target")
        if not target or target in bound:
            continue
        kind = (m.get("Type") or "volume").lower()
        out.append(Mount(
            target=target, source=m.get("Source") or None, type=kind,
            read_only=bool(m.get("ReadOnly")),
            propagation=(m.get("BindOptions") or {}).get("Propagation") if kind == "bind" else None,
            no_copy=bool((m.get("VolumeOptions") or {}).get("NoCopy")) if kind == "volume" else False,
        ))
    return out


def _host_args(hostcfg: dict, cfg: dict) -> dict:
    """Weitere Einstellungen des alten Containers in docker-py-Parameter (7.1.0).
    Nur Gesetztes wird übergeben; ohne Wert gilt der Standard des Dienstes."""
    devices = [f"{d.get('PathOnHost')}:{d.get('PathInContainer')}:{d.get('CgroupPermissions') or 'rwm'}"
               for d in (hostcfg.get("Devices") or []) if d.get("PathOnHost")]
    log = hostcfg.get("LogConfig") or {}
    args = {
        "user": cfg.get("User") or None,
        "cap_add": hostcfg.get("CapAdd") or None,
        "cap_drop": hostcfg.get("CapDrop") or None,
        "security_opt": hostcfg.get("SecurityOpt") or None,
        "extra_hosts": hostcfg.get("ExtraHosts") or None,
        "dns": hostcfg.get("Dns") or None,
        "devices": devices or None,
        "mem_limit": hostcfg.get("Memory") or None,
        "nano_cpus": hostcfg.get("NanoCpus") or None,
        "log_config": ({"Type": log["Type"], "Config": log.get("Config") or {}}
                       if log.get("Type") else None),
    }
    mounts = _mount_args(hostcfg)
    if mounts:
        args["mounts"] = mounts
    return {k: v for k, v in args.items() if v is not None}


def recreate(new_image: str, name: str) -> None:
    """Pull `new_image` and recreate container `name` with the same config.
    Intended to run INSIDE the helper container."""
    client = _client()
    old = client.containers.get(name)
    # Vor dem Pull merken: Danach zeigt der Tag schon auf das neue Image.
    old_image_id = getattr(getattr(old, "image", None), "id", None)
    logger.info(f"Pulling image {new_image} …")
    client.images.pull(new_image)

    info = old.attrs
    cfg = info.get("Config", {})
    hostcfg = info.get("HostConfig", {})
    nets = info.get("NetworkSettings", {}).get("Networks", {}) or {}
    try:
        image_cfg = client.images.get(old_image_id).attrs.get("Config") or {} if old_image_id else {}
    except Exception as e:   # altes Image schon weg → alles als eigene Einstellung behandeln
        logger.warning(f"Old image {old_image_id} not readable ({e}) — taking over the whole configuration")
        image_cfg = {}

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
        environment=_own_env(cfg.get("Env"), image_cfg.get("Env")) or None,
        labels=_own_labels(cfg.get("Labels"), image_cfg.get("Labels")),
        volumes=hostcfg.get("Binds") or [],
        ports=ports or None,
        restart_policy={"Name": restart.get("Name")} if restart.get("Name") else None,
        healthcheck=None,  # inherited from the image
        **_host_args(hostcfg, cfg),
    )
    if network:
        run_kwargs["network"] = network
    # Entrypoint/Cmd nur, wenn der Container sie selbst überschrieben hat — sonst
    # gilt der des NEUEN Images (bis v1.1.73 wurde der alte eingefroren).
    if cfg.get("Entrypoint") and cfg.get("Entrypoint") != image_cfg.get("Entrypoint"):
        run_kwargs["entrypoint"] = cfg.get("Entrypoint")
    if cfg.get("Cmd") and cfg.get("Cmd") != image_cfg.get("Cmd"):
        run_kwargs["command"] = cfg.get("Cmd")
    run_kwargs = {k: v for k, v in run_kwargs.items() if v is not None}

    # Für den Rollback die ID des laufenden Images, nicht den Tag: Nach dem Pull zeigt
    # „:beta" schon auf das NEUE Image, ein Rollback per Tag startete wieder das
    # kaputte (bis v1.1.60).
    old_image = old_image_id or cfg.get("Image")

    logger.info(f"Stopping & removing old container {name} …")
    try:
        old.stop(timeout=20)
    except Exception as e:
        logger.warning(f"Old container did not stop cleanly ({e}) — removing it")
    old.remove(force=True)

    logger.info(f"Starting new container {name} from {new_image} …")
    try:
        client.containers.run(**run_kwargs)
    except Exception as e:
        # Neuer Container startet nicht → App wäre offline. Auf altes Image
        # zurückrollen, damit der Dienst wieder läuft, dann den Fehler melden.
        logger.error(f"New container did not start ({e}) — rolling back to {old_image}")
        run_kwargs["image"] = old_image
        client.containers.run(**run_kwargs)
        raise
    logger.info("Recreate finished.")


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
        logger.error(f"Update failed: {e}")
        sys.exit(1)
