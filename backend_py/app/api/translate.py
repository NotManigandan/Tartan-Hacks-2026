from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import hashlib
import httpx

from app.config import GOOGLE_API_KEY
from app.redis_client import redis_client

router = APIRouter(prefix="/api", tags=["translate"])

GOOGLE_TRANSLATE_URL = "https://translation.googleapis.com/language/translate/v2"


class TranslateRequest(BaseModel):
    text: str
    target_language: str


@router.post("/translate")
async def translate(req: TranslateRequest):
    if not GOOGLE_API_KEY:
        raise HTTPException(status_code=500, detail="Google API key not configured")

    if not req.text.strip():
        return {"translatedText": ""}

    cache_key = hashlib.sha256(
        f"{req.text}:{req.target_language}".encode()
    ).hexdigest()

    cached = redis_client.get(cache_key)
    if cached:
        return {"translatedText": cached, "cached": True}

    payload = {
        "q": req.text,
        "target": req.target_language,
        "format": "text",
        "key": GOOGLE_API_KEY,
    }

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(GOOGLE_TRANSLATE_URL, data=payload)

    if response.status_code != 200:
        raise HTTPException(
            status_code=502,
            detail=f"Translation API error: {response.text}",
        )

    data = response.json()
    translated_text = data["data"]["translations"][0]["translatedText"]

    redis_client.setex(cache_key, 3600, translated_text)

    return {
        "translatedText": translated_text,
        "cached": False,
    }

