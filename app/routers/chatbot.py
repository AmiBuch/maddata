"""
Chatbot recommendation endpoint — supplements user prompt with backend data.

Fetches: forecast (weather + AQ for target date), outbreak alerts.
Uses Gemini to highlight activities suitable for the forecast conditions.
"""
import asyncio
import json
import logging
from pathlib import Path
from datetime import date
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from geopy.geocoders import Nominatim
from pydantic import BaseModel

from app.config import settings, YELP_DATA_PATH
from app.services.forecaster import predict_env_for_date
from app.services.outbreak_tracker import fetch_outbreaks

logger = logging.getLogger(__name__)
router = APIRouter()
_geo = Nominatim(user_agent="breathe-chatbot", timeout=10)


async def _geocode_fallback(destination: str) -> Optional[tuple[float, float, str]]:
    """Fallback: Open-Meteo geocoding (async, no key). Returns (lat, lon, city_str) or None."""
    parts = [p.strip() for p in destination.split(",") if p.strip()]
    if not parts:
        return None
    name = parts[0]
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(
                "https://geocoding-api.open-meteo.com/v1/search",
                params={"name": name, "count": 10, "language": "en"},
            )
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        logger.warning("Open-Meteo geocoding failed: %s", e)
        return None
    results = data.get("results") or []
    if not results:
        return None
    # Prefer US result matching state if user gave "City, ST"
    state_hint = (parts[1].strip().lower() if len(parts) > 1 else "")[:2]
    for r in results:
        admin1 = (r.get("admin1") or "").lower()
        if state_hint and admin1 and (state_hint in admin1 or admin1.startswith("illinois") and state_hint == "il"):
            return (r["latitude"], r["longitude"], r.get("name", name) or name)
    return (results[0]["latitude"], results[0]["longitude"], results[0].get("name", name) or name)


class ChatbotRecommendRequest(BaseModel):
    destination: str
    target_date: str  # YYYY-MM-DD
    dietary_preference: str = "None"


# Restaurant data: backend/app/data/restaurants.json
DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "restaurants.json"

# Normalize state to 2-letter code for strict equality (IL vs Illinois)
US_STATES = {
    "alabama": "al", "alaska": "ak", "arizona": "az", "arkansas": "ar", "california": "ca",
    "colorado": "co", "connecticut": "ct", "delaware": "de", "florida": "fl", "georgia": "ga",
    "hawaii": "hi", "idaho": "id", "illinois": "il", "indiana": "in", "iowa": "ia",
    "kansas": "ks", "kentucky": "ky", "louisiana": "la", "maine": "me", "maryland": "md",
    "massachusetts": "ma", "michigan": "mi", "minnesota": "mn", "mississippi": "ms",
    "missouri": "mo", "montana": "mt", "nebraska": "ne", "nevada": "nv", "new hampshire": "nh",
    "new jersey": "nj", "new mexico": "nm", "new york": "ny", "north carolina": "nc",
    "north dakota": "nd", "ohio": "oh", "oklahoma": "ok", "oregon": "or", "pennsylvania": "pa",
    "rhode island": "ri", "south carolina": "sc", "south dakota": "sd", "tennessee": "tn",
    "texas": "tx", "utah": "ut", "vermont": "vt", "virginia": "va", "washington": "wa",
    "west virginia": "wv", "wisconsin": "wi", "wyoming": "wy", "district of columbia": "dc",
}
US_STATE_ABBREV_TO_NAME = {v: k for k, v in US_STATES.items()}


def _state_to_abbrev(s: str) -> str:
    """Convert state to 2-letter abbrev for strict comparison."""
    t = (s or "").strip().lower()
    if len(t) == 2 and t in {v for v in US_STATES.values()}:
        return t
    return US_STATES.get(t, t)


def _normalize_state_for_match(term: str) -> set:
    """Expand state term to include both full name and abbreviation for matching."""
    t = (term or "").strip().lower()
    if not t:
        return set()
    out = {t}
    if len(t) == 2 and t in US_STATE_ABBREV_TO_NAME:
        out.add(US_STATE_ABBREV_TO_NAME[t])
    elif t in US_STATES:
        out.add(US_STATES[t])
    return out


# Activity categories (non-restaurant) — chicago_sample.json uses these
ACTIVITY_CATEGORIES = {"museum", "park", "bowling", "arcade", "hiking", "tours", "cinema", "gym", "zoo", "observator", "landmark", "amusement", "ferris", "aquarium", "botanical", "nature"}
# Outdoor indicators for is_outdoor
OUTDOOR_INDICATORS = {"park", "hiking", "trail", "outdoor", "zoo", "beach", "garden"}


def _is_outdoor(categories: str) -> bool:
    """True if categories contain outdoor indicators."""
    cats = (categories or "").lower()
    return any(ind in cats for ind in OUTDOOR_INDICATORS)


def load_yelp_data() -> list[dict]:
    """Load restaurants from backend/app/data/restaurants.json. Returns formatted restaurant list."""
    if not DATA_PATH.exists():
        return []
    with open(DATA_PATH, "r", encoding="utf-8") as f:
        raw = json.load(f)
    if not isinstance(raw, list):
        return []
    result = []
    for b in raw:
        if not isinstance(b, dict) or not b.get("name"):
            continue
        cats = (b.get("categories") or "").lower()
        if "restaurants" in cats:
            result.append({
                "name": b.get("name"),
                "city": b.get("city"),
                "state": b.get("state"),
                "rating": b.get("stars", b.get("rating")),
                "stars": b.get("stars"),
                "categories": b.get("categories"),
            })
    return result


def load_yelp_activities() -> list[dict]:
    """
    Load activities from chicago_sample.json (JSON lines format).
    Includes businesses with activity categories (Museum, Park, etc.).
    Returns empty list if file not found — safe fallback, no crash.
    """
    if not YELP_DATA_PATH.exists():
        logger.warning("Yelp data file not found: %s — returning empty activities", YELP_DATA_PATH)
        return []
    result = []
    try:
        with open(YELP_DATA_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    b = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not isinstance(b, dict) or not b.get("name"):
                    continue
                cats = (b.get("categories") or "").lower()
                if not any(ac in cats for ac in ACTIVITY_CATEGORIES):
                    continue
                cats_str = b.get("categories") or ""
                result.append({
                    "name": b.get("name"),
                    "city": b.get("city"),
                    "state": b.get("state"),
                    "type": cats_str.split(",")[0].strip() if cats_str else "",
                    "stars": b.get("stars"),
                    "categories": cats_str,
                    "is_outdoor": _is_outdoor(cats),
                })
    except OSError as e:
        logger.warning("Could not read Yelp data: %s — returning empty activities", e)
        return []
    return result


def _forecast_summary(result: dict) -> str:
    """Build human-readable forecast summary from forecaster output."""
    pred = result.get("predictions", {})
    parts = []
    if "temperature_2m" in pred:
        t = pred["temperature_2m"]
        # Convert °C to °F for display
        mean_c = t.get("mean", 0)
        mean_f = mean_c * 9 / 5 + 32
        parts.append(f"Temperature: ~{mean_f:.0f}°F (range {t.get('min', 0)*9/5+32:.0f}–{t.get('max', 0)*9/5+32:.0f}°F)")
    if "relative_humidity_2m" in pred:
        h = pred["relative_humidity_2m"]
        parts.append(f"Humidity: ~{h.get('mean', 0):.0f}%")
    if "us_aqi" in pred:
        aqi = pred["us_aqi"].get("mean", 0)
        cat = result.get("aqi_category", "Unknown")
        parts.append(f"Air Quality: AQI ~{aqi:.0f} ({cat})")
    if "precipitation" in pred:
        p = pred["precipitation"].get("mean", 0)
        if p > 0:
            parts.append(f"Precipitation: ~{p:.1f} mm expected")
    if "wind_speed_10m" in pred:
        w = pred["wind_speed_10m"].get("mean", 0)
        parts.append(f"Wind: ~{w:.1f} mph")
    return "; ".join(parts) if parts else "Forecast data unavailable"


def _outbreak_summary(reports: list) -> str:
    """Summarize outbreak reports."""
    if not reports:
        return "No active outbreak alerts for this area."
    lines = []
    for r in reports[:5]:
        lines.append(f"- {r.headline} (Severity: {r.severity})")
    return "\n".join(lines)


def _extract_forecast_metrics(forecast_result: dict) -> dict:
    """Extract temperature (°F), AQI, precipitation from forecast result."""
    pred = forecast_result.get("predictions", {})
    temp_c = pred.get("temperature_2m", {}).get("mean", 0) or 0
    temp_f = temp_c * 9 / 5 + 32
    aqi = pred.get("us_aqi", {}).get("mean", 0) or 0
    precip = pred.get("precipitation", {}).get("mean", 0) or 0
    aqi_cat = forecast_result.get("aqi_category", "Unknown")
    aqi_unhealthy = aqi_cat in ("Unhealthy", "Very Unhealthy", "Hazardous", "Unhealthy for Sensitive Groups")
    return {"temperature_f": temp_f, "aqi": aqi, "precipitation": precip, "aqi_unhealthy": aqi_unhealthy}


async def _call_gemini_for_activities(
    forecast_summary: str,
    forecast_metrics: dict,
    outbreak_summary: str,
    restaurants: list,
    activities: list,
    dietary: str,
    dest: str,
    target_date: str,
) -> dict:
    """
    Use Gemini-2.5-flash to filter activities based on weather. NEVER recommend outdoor in unsafe weather.
    Returns { "suitable_restaurants": [...], "suitable_activities": [...], "notes": "..." }
    """
    api_key = settings.gemini_api_key or settings.google_api_key
    if not api_key:
        logger.warning("No Gemini/Google API key; skipping AI activity selection")
        return {
            "suitable_restaurants": restaurants,
            "suitable_activities": activities,
            "notes": "Add GEMINI_API_KEY or GOOGLE_API_KEY to enable AI-powered activity recommendations.",
        }

    temp_f = forecast_metrics.get("temperature_f", 70)
    aqi_unhealthy = forecast_metrics.get("aqi_unhealthy", False)
    has_precip = (forecast_metrics.get("precipitation") or 0) > 0

    try:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=api_key)
        activities_for_ai = activities[:100]  # Limit to avoid token overflow
        prompt = f"""You are a health-aware travel assistant. Filter restaurants and activities for a trip to {dest} on {target_date}.

**Forecast:**
{forecast_summary}

**Weather metrics:** Temperature={temp_f:.0f}°F, AQI unhealthy={aqi_unhealthy}, Precipitation={has_precip}

**Outbreak / Health Alerts:**
{outbreak_summary}

**User dietary preference:** {dietary}

**Available Restaurants:**
{json.dumps(restaurants[:80], indent=2)}

**Available Activities (each has is_outdoor: true/false):**
{json.dumps(activities_for_ai, indent=2)}

IMPORTANT FILTERING RULES (MUST follow):
- If temperature < 40°F: REMOVE all outdoor activities
- If temperature > 95°F: REMOVE all outdoor activities
- If AQI unhealthy: REMOVE all outdoor activities
- If precipitation exists: PRIORITIZE indoor activities, REMOVE outdoor
- NEVER recommend outdoor activities in unsafe weather
- Restaurants: filter by dietary preference

Respond with valid JSON only (no markdown):
{{
  "suitable_restaurants": [filtered restaurant objects],
  "suitable_activities": [filtered activity objects - only indoor when weather is unsafe],
  "notes": "1-2 sentence summary of recommendations and weather cautions"
}}"""

        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=0.2,
            ),
        )
        # Extract text (handle blocked/empty or different response shapes)
        text = getattr(response, "text", None)
        if not text and response.candidates:
            parts = response.candidates[0].content.parts
            if parts:
                text = getattr(parts[0], "text", None) or str(parts[0])
        text = (text or "").strip()
        if not text:
            return {
                "suitable_restaurants": restaurants,
                "suitable_activities": activities,
                "notes": "AI response was empty or blocked. Showing all options.",
            }
        # Remove markdown code blocks if present
        if "```" in text:
            text = text.split("```")[1]
            if text.startswith("json"):
                text = text[4:]
            text = text.strip()
        result = json.loads(text)
        if not isinstance(result, dict):
            raise ValueError("Expected JSON object")
        return result
    except Exception as e:
        logger.exception("Gemini activity selection failed: %s", e)
        return {
            "suitable_restaurants": restaurants,
            "suitable_activities": activities,
            "notes": f"AI selection unavailable: {str(e)[:100]}. Showing all options.",
        }


@router.post("/recommend")
async def recommend(req: ChatbotRecommendRequest):
    """
    Get health-aware recommendations for a destination and date.
    Fetches forecast, outbreaks, and uses Gemini to highlight suitable activities.
    """
    try:
        target = date.fromisoformat(req.target_date)
    except ValueError:
        raise HTTPException(status_code=422, detail="target_date must be YYYY-MM-DD")

    # Geocoding: try Nominatim first, then Open-Meteo fallback
    lat, lon, city_str = None, None, req.destination
    try:
        loc = await asyncio.to_thread(_geo.geocode, req.destination)
        if loc:
            lat, lon = loc.latitude, loc.longitude
            addr = loc.raw.get("address", {}) or {}
            city = addr.get("city") or addr.get("town") or addr.get("village")
            state = addr.get("state")
            city_str = str(city or state or req.destination)
    except Exception as e:
        logger.warning("Nominatim geocoding failed: %s", e)

    if lat is None or lon is None:
        fallback = await _geocode_fallback(req.destination)
        if fallback:
            lat, lon, city_str = fallback
            logger.info("Used Open-Meteo geocoding fallback for %s", req.destination)
        else:
            raise HTTPException(
                status_code=422,
                detail=f"Could not find location '{req.destination}'. Try a city name like 'Edwardsville, IL' or 'Philadelphia, PA'.",
            )

    # Fetch forecast and outbreaks in parallel
    forecast_result, outbreaks = await asyncio.gather(
        predict_env_for_date(lat, lon, target),
        fetch_outbreaks(city_str),
    )

    forecast_summary = _forecast_summary(forecast_result)
    outbreak_summary = _outbreak_summary(outbreaks)
    forecast_metrics = _extract_forecast_metrics(forecast_result)

    # Load restaurants from restaurants.json, activities from chicago_sample.json
    all_restaurants = load_yelp_data()
    all_activities = load_yelp_activities()

    # Parse destination (e.g. "Chicago, IL" -> dest_city, dest_state)
    destination_parts = req.destination.split(",")
    dest_city = destination_parts[0].strip().lower()
    dest_state = ""
    if len(destination_parts) > 1:
        dest_state = _state_to_abbrev(destination_parts[1].strip()).lower()

    print("City:", dest_city)
    print("State:", dest_state)

    def _norm_city(s: str) -> str:
        """Normalize city for matching: St. <-> Saint, etc."""
        t = (s or "").strip().lower()
        for abbr, full in [("st. ", "saint "), ("st ", "saint ")]:
            if t.startswith(abbr):
                t = full + t[len(abbr):]
                break
        return t

    def matches_dest(item, city_strict: bool = True):
        item_city = _norm_city(item.get("city") or "")
        item_state = _state_to_abbrev(item.get("state") or "").strip().lower()
        dest_city_norm = _norm_city(destination_parts[0] if destination_parts else "")
        city_match = (
            item_city == dest_city_norm
            or dest_city_norm in item_city
            or item_city in dest_city_norm
        )
        state_match = (dest_state == "" or item_state == dest_state)
        if city_strict:
            return city_match and state_match
        return state_match  # state-only for activities fallback

    # Restaurants: STRICT city+state match
    restaurants = [r for r in all_restaurants if matches_dest(r)]

    # Activities: strict city+state first; if 0, fall back to state-only
    activities_state_fallback = False
    activities = [a for a in all_activities if matches_dest(a)]
    if len(activities) == 0 and dest_state:
        activities = [a for a in all_activities if matches_dest(a, city_strict=False)]
        if activities:
            activities_state_fallback = True
            print("Activities: using state-level fallback (no city match)")

    print("Total restaurants:", len(restaurants))
    print("Total activities before Gemini:", len(activities))

    # Filter restaurants by dietary preference
    dietary = (req.dietary_preference or "").strip()
    if dietary and dietary.lower() != "none":
        def matches_dietary(item: dict) -> bool:
            cats = (item.get("categories") or "").lower()
            if not cats:
                return False
            d = dietary.lower()
            if d == "vegetarian":
                return "vegetarian" in cats or "vegan" in cats
            if d == "vegan":
                return "vegan" in cats
            if d == "gluten-free":
                return "gluten-free" in cats or "gluten free" in cats
            return d in cats
        restaurants = [r for r in restaurants if matches_dietary(r)]

    # Call Gemini to filter activities by weather (only first 100 to avoid token limit)
    gemini_result = await _call_gemini_for_activities(
        forecast_summary=forecast_summary,
        forecast_metrics=forecast_metrics,
        outbreak_summary=outbreak_summary,
        restaurants=restaurants,
        activities=activities,
        dietary=req.dietary_preference,
        dest=req.destination,
        target_date=req.target_date,
    )

    suitable_activities = gemini_result.get("suitable_activities", [])
    print("Total activities after Gemini:", len(suitable_activities))

    ai_notes = gemini_result.get("notes", "")
    if activities_state_fallback and suitable_activities:
        ai_notes = (ai_notes + " " if ai_notes else "") + "(Activities shown are from within the state; none in dataset for the exact city.)"

    return {
        "destination": req.destination,
        "target_date": req.target_date,
        "forecast_summary": forecast_summary,
        "outbreak_alerts": [{"headline": r.headline, "severity": r.severity} for r in outbreaks[:5]],
        "restaurants": restaurants,
        "activities": suitable_activities,
        "ai_notes": ai_notes,
        "source": forecast_result.get("source", "unknown"),
    }
