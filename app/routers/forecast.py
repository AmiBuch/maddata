"""
Standalone forecast endpoint.

POST /api/forecast/predict
  Body: { "city": "Chicago", "target_date": "2025-08-15" }
  Returns hourly + daily predicted environmental conditions for that city/date.

This lets the frontend (or any client) independently fetch predictions
without going through the full itinerary analysis flow.
"""

import logging
from datetime import date

from fastapi import APIRouter, HTTPException
from geopy.geocoders import Nominatim
from pydantic import BaseModel

from app.services.forecaster import predict_env_for_date

logger = logging.getLogger(__name__)
router = APIRouter()
_geo = Nominatim(user_agent="breathe-forecast")


class ForecastRequest(BaseModel):
    city: str
    target_date: date


@router.post("/predict")
async def predict_conditions(req: ForecastRequest):
    """
    Predict temperature, humidity, AQI, PM2.5, PM10, NO2, O3 and wind speed
    for `city` on `target_date`.

    The model strategy is chosen automatically:
      - ≤ 5 days ahead   → Open-Meteo API forecast (highest accuracy)
      - 6–16 days ahead  → API weather + ML air quality
      - > 16 days ahead  → Full ML from 90-day historical pattern
    """
    loc = _geo.geocode(req.city)
    if not loc:
        raise HTTPException(
            status_code=422,
            detail=f"Could not geocode city: '{req.city}'. Try a more specific name.",
        )

    lat, lon = loc.latitude, loc.longitude
    logger.info("Forecast request: city=%s lat=%.4f lon=%.4f date=%s",
                req.city, lat, lon, req.target_date)

    result = await predict_env_for_date(lat, lon, req.target_date)

    return {
        "city":        loc.address or req.city,
        "lat":         lat,
        "lon":         lon,
        "target_date": req.target_date.isoformat(),
        **result,
    }
