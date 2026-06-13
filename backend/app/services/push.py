"""Web-Push (PWA) notifications.

Self-contained and fail-soft: if the optional `pywebpush`/`cryptography` deps are
missing, every function degrades to a no-op (logged) so the rest of the app keeps
working. A VAPID keypair is generated once and stored under /app/db; browser push
subscriptions are persisted as a JSON list.
"""
import base64
import json
import logging
import os

from app.services import storage

logger = logging.getLogger(__name__)

VAPID_META_PATH = "/app/db/vapid.json"          # {"public_key": "<urlsafe b64>"}
VAPID_PEM_PATH  = "/app/db/vapid_private.pem"    # PKCS8 PEM private key (for pywebpush)
SUBS_PATH       = "/app/db/push_subs.json"       # [subscription_info, ...]
# Apple Web Push validates the VAPID `sub` claim and rejects unreachable values
# like a ".local" address. Use a plausible mailto; overridable via env so it can
# be fixed without a rebuild if a provider is picky.
VAPID_CLAIM_SUB = os.getenv("VAPID_CONTACT", "mailto:admin@printloom.app")

try:
    from pywebpush import webpush, WebPushException
    from cryptography.hazmat.primitives.asymmetric import ec
    from cryptography.hazmat.primitives import serialization
    _HAS_PUSH = True
except Exception as e:  # pragma: no cover - depends on optional deps
    _HAS_PUSH = False
    logger.warning(f"web-push unavailable ({e}) — push notifications disabled")


def available() -> bool:
    return _HAS_PUSH


def _ensure_keys() -> dict:
    """Return {'public_key': ...}, generating + persisting a VAPID keypair once."""
    meta = storage.read_json(VAPID_META_PATH, {})
    if meta.get("public_key") and os.path.exists(VAPID_PEM_PATH):
        return meta
    if not _HAS_PUSH:
        return {}
    priv = ec.generate_private_key(ec.SECP256R1())
    pem = priv.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    raw_pub = priv.public_key().public_bytes(
        serialization.Encoding.X962,
        serialization.PublicFormat.UncompressedPoint,
    )
    pub_b64 = base64.urlsafe_b64encode(raw_pub).rstrip(b"=").decode()
    try:
        os.makedirs(os.path.dirname(VAPID_PEM_PATH), exist_ok=True)
        with open(VAPID_PEM_PATH, "wb") as f:
            f.write(pem)
    except Exception as e:
        logger.warning(f"VAPID key write failed: {e}")
        return {}
    meta = {"public_key": pub_b64}
    storage.write_json(VAPID_META_PATH, meta)
    return meta


def public_key() -> str:
    return _ensure_keys().get("public_key", "")


def _load_subs() -> list:
    return storage.read_json(SUBS_PATH, [])


def _save_subs(subs: list):
    storage.write_json(SUBS_PATH, subs)


def add_subscription(sub: dict) -> int:
    subs = _load_subs()
    endpoint = sub.get("endpoint")
    if endpoint and not any(s.get("endpoint") == endpoint for s in subs):
        subs.append(sub)
        _save_subs(subs)
    return len(subs)


def remove_subscription(endpoint: str) -> int:
    subs = [s for s in _load_subs() if s.get("endpoint") != endpoint]
    _save_subs(subs)
    return len(subs)


def subscription_count() -> int:
    return len(_load_subs())


def send_to_all(title: str, body: str = "", url: str = "/") -> dict:
    """Send a push to every stored subscription. Prunes dead (404/410) endpoints.
    Returns {sent, failed, total, disabled, errors}. Never raises. `errors` carries
    up to a few human-readable reasons (status + body) so the UI can show WHY a
    delivery failed (e.g. Apple Web Push rejecting the VAPID claim)."""
    if not _HAS_PUSH:
        return {"sent": 0, "failed": 0, "total": 0, "disabled": True, "errors": []}
    meta = _ensure_keys()
    if not meta.get("public_key") or not os.path.exists(VAPID_PEM_PATH):
        return {"sent": 0, "failed": 0, "total": 0, "disabled": True, "errors": []}

    payload = json.dumps({"title": title, "body": body, "url": url})
    subs = _load_subs()
    sent = failed = 0
    dead = []
    errors: list[str] = []
    for sub in subs:
        try:
            webpush(
                subscription_info=sub,
                data=payload,
                vapid_private_key=VAPID_PEM_PATH,
                vapid_claims={"sub": VAPID_CLAIM_SUB},
            )
            sent += 1
        except WebPushException as e:
            failed += 1
            resp = getattr(e, "response", None)
            status = getattr(resp, "status_code", None)
            detail = ""
            try:
                detail = (resp.text or "")[:160].replace("\n", " ").strip()
            except Exception:
                pass
            errors.append(f"HTTP {status}: {detail}" if detail else f"HTTP {status}")
            logger.warning(f"web-push send failed (status={status}): {detail or e}")
            if status in (404, 410):
                dead.append(sub.get("endpoint"))
        except Exception as e:
            failed += 1
            errors.append(str(e)[:160])
            logger.warning(f"web-push send failed: {e}")
    if dead:
        _save_subs([s for s in subs if s.get("endpoint") not in dead])
    return {"sent": sent, "failed": failed, "total": len(subs),
            "disabled": False, "errors": errors[:5]}
