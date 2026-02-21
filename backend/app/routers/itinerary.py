"""
Itinerary analysis router.
Takes a structured itinerary + health profile and returns
day-by-day risk scores, activity adjustments, and morning briefings.
"""
import asyncio
from fastapi import APIRouter
from app.models.schemas import ItineraryRequest, ItineraryResponse, DayRisk, RiskScore
from app.services.aqi import get_aqi
from app.services.weather import get_weather, get_forecast
from app.services.risk_scorer import compute_risk
from app.services.outbreak_tracker import fetch_outbreaks
from geopy.geocoders import Nominatim

router = APIRouter()
_geo = Nominatim(user_agent="breathe-app")


def _geocode(city: str) -> tuple[float, float]:
    loc = _geo.geocode(city)
    if loc:
        return loc.latitude, loc.longitude
    return 41.8781, -87.6298   # fallback: Chicago


async def _adjust_activities(activities, aqi_val: int, conditions: list[str]) -> list[dict]:
    adjustments = []
    for act in activities:
        if act.type == "outdoor" and aqi_val > 100:
            adjustments.append({
                "original": f"{act.name} at {act.time}",
                "suggested": f"Move {act.name} to early morning (before 9am) or indoors",
                "reason": f"AQI {aqi_val} — outdoor air quality is unhealthy",
            })
        elif act.type == "outdoor" and aqi_val > 150 and any(
            c in ("asthma", "copd") for c in conditions
        ):
            adjustments.append({
                "original": f"{act.name} at {act.time}",
                "suggested": f"Replace {act.name} with an indoor alternative",
                "reason": f"AQI {aqi_val} — very unhealthy for respiratory conditions",
            })
    return adjustments


def _morning_briefing(risk: RiskScore, aqi_val: int, conditions: list[str]) -> list[str]:
    tips = []
    if aqi_val > 100 and any(c in ("asthma", "copd") for c in conditions):
        tips.append(f"AQI is {aqi_val} — keep your rescue inhaler accessible today")
    if risk.overall in ("High", "Very High"):
        tips.append("Health risk is elevated — consider limiting strenuous outdoor activities")
    if not tips:
        tips.append("Conditions look good for your activities today")
    tips += risk.recommendations[:2]
    return tips[:3]


@router.post("/analyze", response_model=ItineraryResponse)
async def analyze_itinerary(req: ItineraryRequest):
    conditions = req.health_profile.conditions

    day_risks = []
    all_risk_scores = []

    for day in req.days:
        lat, lon = _geocode(day.city)

        aqi, weather, outbreaks = await asyncio.gather(
            get_aqi(lat, lon),
            get_weather(lat, lon),
            fetch_outbreaks(day.city),
        )

        outbreak_score = min(1.0, len([o for o in outbreaks if o.severity == "High"]) * 0.3
                             + len([o for o in outbreaks if o.severity == "Moderate"]) * 0.15)

        risk = compute_risk(aqi, weather, conditions, outbreak_score)
        adjustments = await _adjust_activities(day.activities, aqi.aqi, conditions)

        day_risks.append(DayRisk(
            date=day.date,
            risk=risk,
            aqi_forecast=aqi.aqi,
            weather_summary=f"{weather.description}, {weather.temp_f}°F, {weather.humidity}% humidity",
            activity_adjustments=adjustments,
            morning_briefing=_morning_briefing(risk, aqi.aqi, conditions),
        ))
        all_risk_scores.append(risk.score)

    avg = sum(all_risk_scores) / len(all_risk_scores) if all_risk_scores else 0
    overall = "Low" if avg < 25 else "Moderate" if avg < 50 else "High" if avg < 75 else "Very High"

    return ItineraryResponse(days=day_risks, overall_trip_risk=overall)
