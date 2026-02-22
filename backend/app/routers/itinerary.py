"""
Itinerary analysis router — enhanced with ML environmental forecasting.

For each day in the itinerary the pipeline:
  1. Geocodes the city (Nominatim / OpenStreetMap)
  2. Calls predict_env_for_date() to get ML-predicted conditions for the trip date
     (falls back to current conditions if the forecast fails)
  3. Fetches outbreak news in parallel with the forecast
  4. Runs risk scoring on the predicted AQI + weather
  5. Suggests activity adjustments and morning briefings
"""

import asyncio
import logging
from datetime import date
from typing import Optional

from fastapi import APIRouter
from geopy.geocoders import Nominatim

from app.models.schemas import (
    AQIData, DayRisk, EnvForecast, EnvPrediction,
    ItineraryRequest, ItineraryResponse, RiskScore, WeatherData,
)
from app.services.aqi import get_aqi
from app.services.forecaster import predict_env_for_date
from app.services.outbreak_tracker import fetch_outbreaks
from app.services.risk_scorer import compute_risk
from app.services.weather import get_weather

logger = logging.getLogger(__name__)
router = APIRouter()
_geo = Nominatim(user_agent="purepath-app")


def _geocode(city: str) -> tuple[float, float]:
    loc = _geo.geocode(city)
    if loc:
        return loc.latitude, loc.longitude
    return 41.8781, -87.6298  # fallback: Chicago


# ── Forecast → schema converters ──────────────────────────────────────────────

def _ep(preds: dict, key: str) -> Optional[EnvPrediction]:
    """Extract an EnvPrediction from the predictions sub-dict, or None."""
    p = preds.get(key)
    if not p:
        return None
    return EnvPrediction(**p)


def _forecast_to_env_forecast(forecast: dict) -> EnvForecast:
    preds = forecast.get("predictions", {})
    return EnvForecast(
        source=forecast.get("source", "unknown"),
        days_ahead=forecast.get("days_ahead", 0),
        aqi_category=forecast.get("aqi_category", "Unknown"),
        data_points_used=forecast.get("data_points_used", 0),
        temperature_2m=_ep(preds, "temperature_2m"),
        relative_humidity_2m=_ep(preds, "relative_humidity_2m"),
        wind_speed_10m=_ep(preds, "wind_speed_10m"),
        precipitation=_ep(preds, "precipitation"),
        pm2_5=_ep(preds, "pm2_5"),
        pm10=_ep(preds, "pm10"),
        nitrogen_dioxide=_ep(preds, "nitrogen_dioxide"),
        ozone=_ep(preds, "ozone"),
        us_aqi=_ep(preds, "us_aqi"),
    )


def _forecast_to_aqi(forecast: dict) -> AQIData:
    preds = forecast.get("predictions", {})
    aqi_val = int(preds.get("us_aqi", {}).get("mean", 0) or 0)

    # Determine dominant pollutant from predicted means
    pm25   = preds.get("pm2_5", {}).get("mean", 0) or 0
    ozone  = preds.get("ozone", {}).get("mean", 0) or 0
    no2    = preds.get("nitrogen_dioxide", {}).get("mean", 0) or 0
    if pm25 >= ozone and pm25 >= no2:
        dominant = "PM2.5"
    elif ozone >= no2:
        dominant = "Ozone"
    else:
        dominant = "NO2"

    return AQIData(
        aqi=aqi_val,
        category=forecast.get("aqi_category", "Unknown"),
        dominant_pollutant=dominant,
        pm25=preds.get("pm2_5", {}).get("mean"),
        ozone=preds.get("ozone", {}).get("mean"),
    )


def _forecast_to_weather(forecast: dict) -> WeatherData:
    preds = forecast.get("predictions", {})
    temp_c   = preds.get("temperature_2m", {}).get("mean", 20) or 20
    temp_f   = round(temp_c * 9 / 5 + 32, 1)
    humidity = int(preds.get("relative_humidity_2m", {}).get("mean", 50) or 50)
    wind_mph = preds.get("wind_speed_10m", {}).get("mean")
    return WeatherData(
        temp_f=temp_f,
        feels_like_f=temp_f,
        humidity=humidity,
        description="Predicted conditions",
        wind_mph=wind_mph,
    )


# ── Trip-day helpers ───────────────────────────────────────────────────────────

def _weather_summary(forecast: dict) -> str:
    preds = forecast.get("predictions", {})
    temp_c = preds.get("temperature_2m", {}).get("mean", 20) or 20
    temp_f = round(temp_c * 9 / 5 + 32, 1)
    humidity = int(preds.get("relative_humidity_2m", {}).get("mean", 50) or 50)

    parts = [f"Predicted {temp_f}°F, {humidity}% humidity"]
    for label, key, unit in [
        ("PM2.5", "pm2_5",          "µg/m³"),
        ("PM10",  "pm10",           "µg/m³"),
        ("NO₂",   "nitrogen_dioxide","µg/m³"),
        ("O₃",    "ozone",          "µg/m³"),
        ("Wind",  "wind_speed_10m", "mph"),
    ]:
        val = preds.get(key, {}).get("mean")
        if val is not None:
            parts.append(f"{label}: {val:.1f} {unit}")

    return " · ".join(parts)


async def _adjust_activities(activities, aqi_val: int,
                              conditions: list[str]) -> list[dict]:
    adjustments = []
    for act in activities:
        if act.type in ("outdoor", "hiking") and aqi_val > 100:
            adjustments.append({
                "original":  f"{act.name} at {act.time}",
                "suggested": f"Move {act.name} to early morning (before 9 am) or indoors",
                "reason":    f"Predicted AQI {aqi_val} — outdoor air may be unhealthy",
            })
        if act.type in ("outdoor", "hiking") and aqi_val > 150 and any(
            c in ("asthma", "copd") for c in conditions
        ):
            adjustments[-1]["suggested"] = f"Replace {act.name} with an indoor alternative"
            adjustments[-1]["reason"]    = (
                f"Predicted AQI {aqi_val} — very unhealthy for respiratory conditions"
            )
    return adjustments


def _source_label(source: str) -> str:
    return {
        "api_direct":        "Live Forecast — high confidence",
        "ml_aq_api_weather": "Hybrid Forecast — weather from API, AQ from ML pattern",
        "ml_full":           "Historical Pattern — seasonal ML estimate",
        "error_fallback":    "Current conditions (forecast unavailable)",
    }.get(source, "Predicted conditions")


def _morning_briefing(risk: RiskScore, aqi_val: int,
                       conditions: list[str], source: str) -> list[str]:
    tips: list[str] = []
    if aqi_val > 100 and any(c in ("asthma", "copd") for c in conditions):
        tips.append(f"Predicted AQI {aqi_val} — keep your rescue inhaler accessible")
    if risk.overall in ("High", "Very High"):
        tips.append("Elevated health risk predicted — consider limiting strenuous outdoor activity")
    tips.append(_source_label(source))
    tips += risk.recommendations[:2]
    return tips[:4]


# ── Main endpoint ──────────────────────────────────────────────────────────────

@router.post("/analyze", response_model=ItineraryResponse)
async def analyze_itinerary(req: ItineraryRequest):
    conditions = req.health_profile.conditions
    day_risks: list[DayRisk] = []
    all_risk_scores: list[int] = []

    for day in req.days:
        lat, lon = _geocode(day.city)

        try:
            trip_date = date.fromisoformat(day.date)
        except ValueError:
            trip_date = date.today()

        # Run forecast + outbreaks in parallel
        forecast_result, outbreaks = await asyncio.gather(
            predict_env_for_date(lat, lon, trip_date),
            fetch_outbreaks(day.city),
        )

        forecast_source = forecast_result.get("source", "unknown")

        # If the forecast came back empty (error_fallback), also get live conditions
        if forecast_source == "error_fallback" or not forecast_result.get("predictions"):
            logger.warning("Forecast empty for %s on %s — using live conditions", day.city, day.date)
            aqi, weather = await asyncio.gather(get_aqi(lat, lon), get_weather(lat, lon))
        else:
            aqi     = _forecast_to_aqi(forecast_result)
            weather = _forecast_to_weather(forecast_result)

        env_forecast  = _forecast_to_env_forecast(forecast_result)

        outbreak_score = min(
            1.0,
            len([o for o in outbreaks if o.severity == "High"])     * 0.3
            + len([o for o in outbreaks if o.severity == "Moderate"]) * 0.15,
        )

        risk        = compute_risk(aqi, weather, conditions, outbreak_score)
        adjustments = await _adjust_activities(day.activities, aqi.aqi, conditions)

        day_risks.append(DayRisk(
            date=day.date,
            risk=risk,
            aqi_forecast=aqi.aqi,
            weather_summary=_weather_summary(forecast_result)
                if forecast_source != "error_fallback"
                else f"{weather.description}, {weather.temp_f}°F, {weather.humidity}% humidity",
            activity_adjustments=adjustments,
            morning_briefing=_morning_briefing(risk, aqi.aqi, conditions, forecast_source),
            env_forecast=env_forecast,
        ))
        all_risk_scores.append(risk.score)

    avg     = sum(all_risk_scores) / len(all_risk_scores) if all_risk_scores else 0
    overall = "Low" if avg < 25 else "Moderate" if avg < 50 else "High" if avg < 75 else "Very High"

    return ItineraryResponse(days=day_risks, overall_trip_risk=overall)
