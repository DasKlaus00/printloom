from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional

from app.services import push

router = APIRouter()


class Subscription(BaseModel):
    endpoint: str
    keys: dict
    expirationTime: Optional[float] = None


class Unsub(BaseModel):
    endpoint: str


@router.get("/public-key")
def get_public_key():
    return {"public_key": push.public_key(), "available": push.available()}


@router.get("/status")
def get_status():
    return {"available": push.available(), "subscriptions": push.subscription_count()}


@router.post("/subscribe")
def subscribe(sub: Subscription):
    count = push.add_subscription(sub.model_dump())
    return {"success": True, "subscriptions": count}


@router.post("/unsubscribe")
def unsubscribe(body: Unsub):
    count = push.remove_subscription(body.endpoint)
    return {"success": True, "subscriptions": count}


@router.post("/test")
def test_push():
    result = push.send_to_all("Printloom", "Test-Benachrichtigung — Web-Push funktioniert ✓", "/")
    return result
