from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime


# ── Shared ────────────────────────────────────────────────────────────────────

class HealthProfile(BaseModel):
    conditions: List[str] = []          # e.g. ["asthma", "epilepsy"]
    dietary_restrictions: List[str] = []  # e.g. ["gluten-free", "nut allergy"]


class GeoPoint(BaseModel):
    lat: float
    lon: float
    city: Optional[str] = None
    neighborhood: Optional[str] = None


# ── Conditions (Right Now) ────────────────────────────────────────────────────

class CurrentConditionsRequest(BaseModel):
    lat: float
    lon: float
    health_profile: Optional[HealthProfile] = None


class AQIData(BaseModel):
    aqi: int
    category: str          # Good / Moderate / Unhealthy / etc.
    dominant_pollutant: Optional[str] = None
    pm25: Optional[float] = None
    ozone: Optional[float] = None


class WeatherData(BaseModel):
    temp_f: float
    feels_like_f: float
    humidity: int
    description: str
    uv_index: Optional[float] = None
    wind_mph: Optional[float] = None


class RiskScore(BaseModel):
    overall: str           # Low / Moderate / High / Very High
    score: int             # 0-100
    factors: List[str]     # human-readable risk drivers
    recommendations: List[str]


class CurrentConditionsResponse(BaseModel):
    location: GeoPoint
    aqi: AQIData
    weather: WeatherData
    risk: RiskScore
    timestamp: datetime


# ── Outbreaks ─────────────────────────────────────────────────────────────────

class OutbreakReport(BaseModel):
    id: str
    headline: str
    source: str
    published_at: datetime
    url: str
    condition_tags: List[str]   # ["respiratory", "GI", "flu"]
    neighborhood: Optional[str] = None
    city: str
    severity: str               # Low / Moderate / High


class OutbreakFeedResponse(BaseModel):
    city: str
    reports: List[OutbreakReport]
    last_updated: datetime


# ── Environmental Forecast ────────────────────────────────────────────────────

class EnvPrediction(BaseModel):
    """Daily statistics for a single environmental variable."""
    mean: float
    min:  float
    max:  float
    p25:  Optional[float] = None   # 25th percentile across 24 hourly predictions
    p75:  Optional[float] = None   # 75th percentile


class EnvForecast(BaseModel):
    """
    Predicted environmental conditions for a single day.
    Populated by the forecaster service; included in DayRisk.
    """
    source: str               # "api_direct" | "ml_aq_api_weather" | "ml_full" | "error_fallback"
    days_ahead: int
    aqi_category: str
    data_points_used: int = 0
    temperature_2m:        Optional[EnvPrediction] = None
    relative_humidity_2m:  Optional[EnvPrediction] = None
    wind_speed_10m:        Optional[EnvPrediction] = None
    precipitation:         Optional[EnvPrediction] = None
    pm2_5:                 Optional[EnvPrediction] = None
    pm10:                  Optional[EnvPrediction] = None
    nitrogen_dioxide:      Optional[EnvPrediction] = None
    ozone:                 Optional[EnvPrediction] = None
    us_aqi:                Optional[EnvPrediction] = None


# ── Itinerary ─────────────────────────────────────────────────────────────────

class Activity(BaseModel):
    name: str
    type: str              # outdoor / indoor / dining / transit
    time: str              # "09:00"
    location: Optional[GeoPoint] = None
    notes: Optional[str] = None


class ItineraryDay(BaseModel):
    date: str              # "2025-07-14"
    city: str
    activities: List[Activity]


class ItineraryRequest(BaseModel):
    days: List[ItineraryDay]
    health_profile: HealthProfile


class DayRisk(BaseModel):
    date: str
    risk: RiskScore
    aqi_forecast: Optional[int] = None
    weather_summary: str
    activity_adjustments: List[dict]   # {original, suggested, reason}
    morning_briefing: List[str]        # top 3 watch-outs
    env_forecast: Optional[EnvForecast] = None  # ML-predicted conditions for trip date


class ItineraryResponse(BaseModel):
    days: List[DayRisk]
    overall_trip_risk: str


# ── Chat ──────────────────────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: str              # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]
    health_profile: Optional[HealthProfile] = None
    destination: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    suggested_activities: Optional[List[str]] = None


# ── Heatmap ───────────────────────────────────────────────────────────────────

class HeatmapCell(BaseModel):
    lat: float
    lon: float
    aqi: Optional[int] = None
    outbreak_score: Optional[float] = None
    composite_risk: float   # 0-1 for heat intensity


class HeatmapResponse(BaseModel):
    city: str
    cells: List[HeatmapCell]
    layers: dict            # layer metadata
    generated_at: datetime
