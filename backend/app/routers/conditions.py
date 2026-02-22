from datetime import datetime, timezone
from fastapi import APIRouter
from app.models.schemas import CurrentConditionsRequest, CurrentConditionsResponse, GeoPoint
from app.services.aqi import get_aqi
from app.services.weather import get_weather
from app.services.risk_scorer import compute_risk

router = APIRouter()


@router.post("/", response_model=CurrentConditionsResponse)
async def get_current_conditions(req: CurrentConditionsRequest):
    aqi, weather = await _parallel(req.lat, req.lon)
    conditions = req.health_profile.conditions if req.health_profile else []
    risk = compute_risk(aqi, weather, conditions, outbreak_score=0.0)

    return CurrentConditionsResponse(
        location=GeoPoint(lat=req.lat, lon=req.lon),
        aqi=aqi,
        weather=weather,
        risk=risk,
        timestamp=datetime.now(timezone.utc),
    )


async def _parallel(lat: float, lon: float):
    import asyncio
    return await asyncio.gather(get_aqi(lat, lon), get_weather(lat, lon))
