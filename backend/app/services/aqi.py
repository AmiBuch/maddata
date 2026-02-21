"""
AQI data fetching.
Primary: AirNow (EPA) API — https://www.airnowapi.org/
Fallback: Open-Meteo air quality (no key required)
"""
import httpx
from app.config import settings
from app.models.schemas import AQIData

AIRNOW_BASE = "https://www.airnowapi.org/aq/observation/latLong/current/"
OPENMETEO_AQ_BASE = "https://air-quality-api.open-meteo.com/v1/air-quality"

AQI_CATEGORIES = [
    (50,  "Good"),
    (100, "Moderate"),
    (150, "Unhealthy for Sensitive Groups"),
    (200, "Unhealthy"),
    (300, "Very Unhealthy"),
    (500, "Hazardous"),
]


def _category(aqi: int) -> str:
    for threshold, label in AQI_CATEGORIES:
        if aqi <= threshold:
            return label
    return "Hazardous"


async def get_aqi(lat: float, lon: float) -> AQIData:
    if settings.airnow_api_key:
        return await _airnow(lat, lon)
    return await _openmeteo(lat, lon)


async def _airnow(lat: float, lon: float) -> AQIData:
    params = {
        "format": "application/json",
        "latitude": lat,
        "longitude": lon,
        "distance": 25,
        "API_KEY": settings.airnow_api_key,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(AIRNOW_BASE, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

    if not data:
        return AQIData(aqi=0, category="Unknown")

    # AirNow returns one entry per pollutant; take the highest AQI
    best = max(data, key=lambda x: x.get("AQI", 0))
    aqi_val = best.get("AQI", 0)
    pollutant = best.get("ParameterName", "")

    pm25 = next((d["AQI"] for d in data if d.get("ParameterName") == "PM2.5"), None)
    ozone = next((d["AQI"] for d in data if d.get("ParameterName") == "OZONE"), None)

    return AQIData(
        aqi=aqi_val,
        category=_category(aqi_val),
        dominant_pollutant=pollutant,
        pm25=pm25,
        ozone=ozone,
    )


async def _openmeteo(lat: float, lon: float) -> AQIData:
    """Open-Meteo air quality — free, no API key."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "us_aqi,pm2_5,ozone",
        "timezone": "auto",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(OPENMETEO_AQ_BASE, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

    current = data.get("current", {})
    aqi_val = int(current.get("us_aqi") or 0)
    pm25 = current.get("pm2_5")
    ozone = current.get("ozone")

    return AQIData(
        aqi=aqi_val,
        category=_category(aqi_val),
        dominant_pollutant="PM2.5" if pm25 and pm25 > 35 else "Ozone",
        pm25=pm25,
        ozone=ozone,
    )
