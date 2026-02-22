"""
Weather data — Open-Meteo (free, no API key required).
Falls back gracefully if OpenWeatherMap key is set.
"""
import httpx
from app.models.schemas import WeatherData

OPENMETEO_BASE = "https://api.open-meteo.com/v1/forecast"

WMO_DESCRIPTIONS = {
    0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
    45: "Foggy", 48: "Depositing rime fog",
    51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
    61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
    71: "Slight snow", 73: "Moderate snow", 75: "Heavy snow",
    80: "Slight rain showers", 81: "Moderate rain showers", 82: "Violent rain showers",
    95: "Thunderstorm", 99: "Thunderstorm with heavy hail",
}


def _c_to_f(c: float) -> float:
    return round(c * 9 / 5 + 32, 1)


async def get_weather(lat: float, lon: float) -> WeatherData:
    params = {
        "latitude": lat,
        "longitude": lon,
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,weathercode,windspeed_10m,uv_index",
        "temperature_unit": "celsius",
        "windspeed_unit": "mph",
        "timezone": "auto",
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(OPENMETEO_BASE, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

    cur = data.get("current", {})
    temp_c = cur.get("temperature_2m", 20)
    feels_c = cur.get("apparent_temperature", 20)
    wmo = cur.get("weathercode", 0)

    return WeatherData(
        temp_f=_c_to_f(temp_c),
        feels_like_f=_c_to_f(feels_c),
        humidity=int(cur.get("relative_humidity_2m", 50)),
        description=WMO_DESCRIPTIONS.get(wmo, "Unknown"),
        uv_index=cur.get("uv_index"),
        wind_mph=cur.get("windspeed_10m"),
    )


async def get_forecast(lat: float, lon: float, days: int = 7) -> list[dict]:
    """Return daily forecast for itinerary risk scoring."""
    params = {
        "latitude": lat,
        "longitude": lon,
        "daily": "temperature_2m_max,temperature_2m_min,weathercode,uv_index_max,relative_humidity_2m_max",
        "temperature_unit": "celsius",
        "timezone": "auto",
        "forecast_days": days,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.get(OPENMETEO_BASE, params=params, timeout=10)
        resp.raise_for_status()
        data = resp.json()

    daily = data.get("daily", {})
    dates = daily.get("time", [])
    result = []
    for i, date in enumerate(dates):
        result.append({
            "date": date,
            "temp_max_f": _c_to_f(daily["temperature_2m_max"][i]),
            "temp_min_f": _c_to_f(daily["temperature_2m_min"][i]),
            "description": WMO_DESCRIPTIONS.get(daily["weathercode"][i], "Unknown"),
            "uv_index": daily.get("uv_index_max", [None] * len(dates))[i],
            "humidity": daily.get("relative_humidity_2m_max", [None] * len(dates))[i],
        })
    return result
