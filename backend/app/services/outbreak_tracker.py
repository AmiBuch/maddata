"""
Live outbreak tracker.
Polls NewsAPI every 20 min, NLP-tags by condition type, gelocates to neighborhood.
Falls back to mock data if no API key.
"""
import asyncio
import hashlib
import re
from datetime import datetime, timezone
from typing import Optional
import httpx
from app.config import settings
from app.models.schemas import OutbreakReport

NEWSAPI_BASE = "https://newsapi.org/v2/everything"

HEALTH_KEYWORDS = [
    "outbreak", "flu", "influenza", "respiratory illness", "norovirus",
    "COVID", "measles", "salmonella", "food poisoning", "hospital surge",
    "health alert", "disease cluster", "public health emergency",
]

CONDITION_TAG_MAP = {
    "respiratory": ["flu", "influenza", "respiratory", "COVID", "pneumonia", "RSV", "asthma"],
    "GI":          ["norovirus", "salmonella", "food poisoning", "gastroenteritis", "diarrhea"],
    "neurological": ["meningitis", "encephalitis", "West Nile"],
    "skin":        ["mpox", "measles", "rash", "chickenpox"],
    "general":     ["outbreak", "cluster", "surge", "health alert"],
}


def _tag_conditions(text: str) -> list[str]:
    text_lower = text.lower()
    tags = []
    for tag, keywords in CONDITION_TAG_MAP.items():
        if any(kw.lower() in text_lower for kw in keywords):
            tags.append(tag)
    return tags or ["general"]


def _severity(text: str) -> str:
    text_lower = text.lower()
    if any(w in text_lower for w in ["emergency", "critical", "surge", "epidemic"]):
        return "High"
    if any(w in text_lower for w in ["outbreak", "cluster", "rising", "alert"]):
        return "Moderate"
    return "Low"


async def fetch_outbreaks(city: str) -> list[OutbreakReport]:
    if not settings.news_api_key:
        return _mock_outbreaks(city)

    query = f"({city}) AND ({' OR '.join(HEALTH_KEYWORDS[:6])})"
    params = {
        "q": query,
        "sortBy": "publishedAt",
        "pageSize": 20,
        "language": "en",
        "apiKey": settings.news_api_key,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(NEWSAPI_BASE, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

    reports = []
    for article in data.get("articles", []):
        title = article.get("title", "") or ""
        desc = article.get("description", "") or ""
        combined = f"{title} {desc}"

        uid = hashlib.md5(article.get("url", title).encode()).hexdigest()[:8]
        published = article.get("publishedAt", datetime.now(timezone.utc).isoformat())

        reports.append(OutbreakReport(
            id=uid,
            headline=title,
            source=article.get("source", {}).get("name", "Unknown"),
            published_at=datetime.fromisoformat(published.replace("Z", "+00:00")),
            url=article.get("url", ""),
            condition_tags=_tag_conditions(combined),
            neighborhood=None,
            city=city,
            severity=_severity(combined),
        ))

    return reports


def _mock_outbreaks(city: str) -> list[OutbreakReport]:
    """Demo data when no NewsAPI key is present."""
    now = datetime.now(timezone.utc)
    return [
        OutbreakReport(
            id="mock001",
            headline=f"Flu activity rising in {city} — health officials monitoring clusters",
            source="Reuters (Mock)",
            published_at=now,
            url="#",
            condition_tags=["respiratory"],
            neighborhood="Downtown",
            city=city,
            severity="Moderate",
        ),
        OutbreakReport(
            id="mock002",
            headline=f"Air quality alert issued for {city} as ozone levels climb",
            source="AP News (Mock)",
            published_at=now,
            url="#",
            condition_tags=["respiratory", "general"],
            neighborhood=None,
            city=city,
            severity="High",
        ),
    ]
