"""
Environmental time-series forecasting pipeline.

Data sources (all free, no API keys required):
  - Open-Meteo Archive API   — historical hourly weather (up to 2 years)
  - Open-Meteo AQ API        — historical + forecast air quality (past_days up to 92)
  - Open-Meteo Forecast API  — weather forecast up to 16 days ahead

Variables predicted (hourly → daily stats):
  Weather : temperature_2m (°C), relative_humidity_2m (%), wind_speed_10m (mph),
            precipitation (mm)
  Air Quality: pm2_5 (µg/m³), pm10 (µg/m³), nitrogen_dioxide (µg/m³),
               ozone (µg/m³), us_aqi

Strategy by how far ahead the target date is:
  ≤ 5 days   → use Open-Meteo forecast APIs directly (highest accuracy)
  6–16 days  → weather from Open-Meteo forecast + AQ from ML (trained on 90 d history)
  > 16 days  → full ML for all variables (seasonal pattern from 90 d history)

ML model: GradientBoostingRegressor (sklearn, already a dep) wrapped in
          MultiOutputRegressor.  Features are purely cyclical time encodings
          (hour-of-day, day-of-week, day-of-year, month) so the model learns
          the location's diurnal and seasonal pattern from ~2 160 hourly points.

Trained models are cached in-process (keyed by rounded lat/lon + today's date)
to avoid re-training on repeated requests for the same city.
"""

import asyncio
import logging
from datetime import date, datetime, timedelta
from typing import Optional

import httpx
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.multioutput import MultiOutputRegressor

logger = logging.getLogger(__name__)

# ── API endpoints ──────────────────────────────────────────────────────────────
_ARCHIVE_URL  = "https://archive-api.open-meteo.com/v1/archive"
_AQ_URL       = "https://air-quality-api.open-meteo.com/v1/air-quality"
_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

# ── Variable groups ────────────────────────────────────────────────────────────
WEATHER_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "precipitation",
]
AQ_VARS = [
    "pm2_5",
    "pm10",
    "nitrogen_dioxide",
    "ozone",
    "us_aqi",
]
ALL_TARGETS  = WEATHER_VARS + AQ_VARS

# Cyclical features used for model training & inference
FEATURE_COLS = [
    "hour_sin", "hour_cos",
    "dow_sin",  "dow_cos",
    "doy_sin",  "doy_cos",
    "month_sin","month_cos",
]

# ── In-memory model cache ──────────────────────────────────────────────────────
# key: "{rounded_lat}_{rounded_lon}_{today_iso}" → MultiOutputRegressor
_MODEL_CACHE: dict = {}
_CACHE_MAX = 30  # evict LRU when full


# ═══════════════════════════════════════════════════════════════════════════════
# Data fetching helpers
# ═══════════════════════════════════════════════════════════════════════════════

async def _fetch_weather_history(lat: float, lon: float,
                                  start: date, end: date) -> pd.DataFrame:
    """Fetch hourly historical weather from the Open-Meteo Archive API."""
    params = {
        "latitude":   lat,
        "longitude":  lon,
        "start_date": start.isoformat(),
        "end_date":   end.isoformat(),
        "hourly":     ",".join(WEATHER_VARS),
        "wind_speed_unit": "mph",
        "timezone":   "auto",
    }
    async with httpx.AsyncClient(timeout=40) as client:
        r = await client.get(_ARCHIVE_URL, params=params)
        r.raise_for_status()
        data = r.json()

    hourly = data.get("hourly", {})
    df = pd.DataFrame({"time": pd.to_datetime(hourly.get("time", []))})
    for v in WEATHER_VARS:
        df[v] = hourly.get(v, [None] * len(df))
    return df


async def _fetch_aq_history(lat: float, lon: float,
                             past_days: int = 92) -> pd.DataFrame:
    """Fetch historical air-quality data via the Open-Meteo AQ `past_days` param."""
    params = {
        "latitude":     lat,
        "longitude":    lon,
        "hourly":       ",".join(AQ_VARS),
        "past_days":    min(past_days, 92),
        "forecast_days": 1,
        "timezone":     "auto",
    }
    async with httpx.AsyncClient(timeout=40) as client:
        r = await client.get(_AQ_URL, params=params)
        r.raise_for_status()
        data = r.json()

    hourly = data.get("hourly", {})
    df = pd.DataFrame({"time": pd.to_datetime(hourly.get("time", []))})
    for v in AQ_VARS:
        df[v] = hourly.get(v, [None] * len(df))
    return df


async def _fetch_weather_forecast(lat: float, lon: float,
                                   days: int = 16) -> pd.DataFrame:
    """Fetch hourly weather forecast (up to 16 days) from Open-Meteo."""
    params = {
        "latitude":    lat,
        "longitude":   lon,
        "hourly":      ",".join(WEATHER_VARS),
        "forecast_days": min(days, 16),
        "wind_speed_unit": "mph",
        "timezone":    "auto",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(_FORECAST_URL, params=params)
        r.raise_for_status()
        data = r.json()

    hourly = data.get("hourly", {})
    df = pd.DataFrame({"time": pd.to_datetime(hourly.get("time", []))})
    for v in WEATHER_VARS:
        df[v] = hourly.get(v, [None] * len(df))
    return df


async def _fetch_aq_forecast(lat: float, lon: float,
                              days: int = 5) -> pd.DataFrame:
    """Fetch hourly AQ forecast (up to 5 days) from Open-Meteo."""
    params = {
        "latitude":    lat,
        "longitude":   lon,
        "hourly":      ",".join(AQ_VARS),
        "forecast_days": min(days, 5),
        "timezone":    "auto",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(_AQ_URL, params=params)
        r.raise_for_status()
        data = r.json()

    hourly = data.get("hourly", {})
    df = pd.DataFrame({"time": pd.to_datetime(hourly.get("time", []))})
    for v in AQ_VARS:
        df[v] = hourly.get(v, [None] * len(df))
    return df


# ═══════════════════════════════════════════════════════════════════════════════
# Feature engineering
# ═══════════════════════════════════════════════════════════════════════════════

def _add_cyclical_features(df: pd.DataFrame) -> pd.DataFrame:
    """Add sin/cos cyclical time features. Requires a 'time' datetime column."""
    t = df["time"]
    hour = t.dt.hour
    dow  = t.dt.dayofweek
    doy  = t.dt.dayofyear
    mon  = t.dt.month

    df = df.copy()
    df["hour_sin"], df["hour_cos"] = np.sin(2*np.pi*hour/24),  np.cos(2*np.pi*hour/24)
    df["dow_sin"],  df["dow_cos"]  = np.sin(2*np.pi*dow/7),    np.cos(2*np.pi*dow/7)
    df["doy_sin"],  df["doy_cos"]  = np.sin(2*np.pi*doy/365),  np.cos(2*np.pi*doy/365)
    df["month_sin"],df["month_cos"]= np.sin(2*np.pi*mon/12),   np.cos(2*np.pi*mon/12)
    return df


def _build_inference_frame(target_date: date) -> pd.DataFrame:
    """Return a 24-row DataFrame (one row per hour) with cyclical features for target_date."""
    hours = [
        datetime(target_date.year, target_date.month, target_date.day, h)
        for h in range(24)
    ]
    df = pd.DataFrame({"time": pd.to_datetime(hours)})
    return _add_cyclical_features(df)


# ═══════════════════════════════════════════════════════════════════════════════
# Model training & caching
# ═══════════════════════════════════════════════════════════════════════════════

def _train_model(merged: pd.DataFrame,
                 target_cols: list[str]) -> MultiOutputRegressor:
    """Train GBM on merged historical DataFrame."""
    # Drop rows where ALL targets are NaN, fill remaining NaN with median
    merged = merged.dropna(subset=FEATURE_COLS)
    Y_df = merged[target_cols].copy()
    for col in target_cols:
        Y_df[col] = Y_df[col].fillna(Y_df[col].median()).clip(lower=0)

    X = merged[FEATURE_COLS].values
    Y = Y_df.values

    model = MultiOutputRegressor(
        GradientBoostingRegressor(
            n_estimators=60,
            max_depth=3,
            learning_rate=0.1,
            subsample=0.8,
            random_state=42,
        ),
        n_jobs=-1,
    )
    model.fit(X, Y)
    return model


def _cache_key(lat: float, lon: float) -> str:
    today = date.today().isoformat()
    # Round to 2 decimal places (~1 km) so nearby points share a model
    return f"{round(lat, 2)}_{round(lon, 2)}_{today}"


def _get_or_train(lat: float, lon: float,
                  merged: pd.DataFrame,
                  target_cols: list[str]) -> MultiOutputRegressor:
    key = _cache_key(lat, lon)
    if key in _MODEL_CACHE:
        logger.debug("Forecast model cache hit for %s", key)
        return _MODEL_CACHE[key]

    logger.info("Training forecast model for %s (%d points, %d targets)",
                key, len(merged), len(target_cols))
    model = _train_model(merged, target_cols)

    if len(_MODEL_CACHE) >= _CACHE_MAX:
        # Evict the oldest entry (insertion-ordered dict in Python ≥ 3.7)
        _MODEL_CACHE.pop(next(iter(_MODEL_CACHE)))
    _MODEL_CACHE[key] = model
    return model


# ═══════════════════════════════════════════════════════════════════════════════
# Result helpers
# ═══════════════════════════════════════════════════════════════════════════════

def _aqi_category(aqi: float) -> str:
    for threshold, label in [
        (50,  "Good"),
        (100, "Moderate"),
        (150, "Unhealthy for Sensitive Groups"),
        (200, "Unhealthy"),
        (300, "Very Unhealthy"),
    ]:
        if aqi <= threshold:
            return label
    return "Hazardous"


def _summarise(day_df: pd.DataFrame, target_cols: list[str],
               days_ahead: int, source: str, n_train: int) -> dict:
    """Aggregate a 24-row hourly DataFrame into a prediction result dict."""
    predictions: dict = {}
    available = [c for c in target_cols if c in day_df.columns]

    for col in available:
        vals = day_df[col].clip(lower=0).dropna()
        if vals.empty:
            continue
        predictions[col] = {
            "mean": round(float(vals.mean()), 2),
            "min":  round(float(vals.min()),  2),
            "max":  round(float(vals.max()),  2),
            "p25":  round(float(vals.quantile(0.25)), 2),
            "p75":  round(float(vals.quantile(0.75)), 2),
        }

    aqi_mean = predictions.get("us_aqi", {}).get("mean", 0) or 0

    # Build hourly breakdown (24 entries)
    hourly: list[dict] = []
    if "time" in day_df.columns:
        for _, row in day_df.iterrows():
            entry: dict = {"hour": int(row["time"].hour)}
            for col in available:
                v = row.get(col)
                if v is not None and pd.notna(v):
                    entry[col] = round(max(0.0, float(v)), 2)
            hourly.append(entry)

    return {
        "days_ahead":        days_ahead,
        "source":            source,
        "predictions":       predictions,
        "hourly_breakdown":  hourly,
        "aqi_category":      _aqi_category(aqi_mean),
        "data_points_used":  n_train,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Strategy implementations
# ═══════════════════════════════════════════════════════════════════════════════

async def _predict_from_api(lat: float, lon: float,
                             target_date: date, days_ahead: int) -> dict:
    """≤ 5 days ahead: pull directly from Open-Meteo forecast APIs."""
    fcast_days = max(days_ahead + 2, 2)
    wx_df, aq_df = await asyncio.gather(
        _fetch_weather_forecast(lat, lon, days=fcast_days),
        _fetch_aq_forecast(lat, lon, days=min(fcast_days, 5)),
    )
    merged = pd.merge(wx_df, aq_df, on="time", how="outer").sort_values("time")
    day_df = merged[merged["time"].dt.date == target_date].copy()

    if day_df.empty:
        # Fallback: use all available data and filter approximately
        day_df = merged.tail(24).copy()

    available_targets = [c for c in ALL_TARGETS if c in day_df.columns]
    return _summarise(day_df, available_targets, days_ahead,
                      source="api_direct", n_train=0)


async def _predict_mixed(lat: float, lon: float,
                          target_date: date, days_ahead: int) -> dict:
    """6–16 days: weather from Open-Meteo forecast + AQ from ML."""
    today = date.today()
    hist_end   = today - timedelta(days=3)   # archive lag buffer
    hist_start = hist_end - timedelta(days=89)

    wx_forecast_df, aq_hist_df, wx_hist_df = await asyncio.gather(
        _fetch_weather_forecast(lat, lon, days=days_ahead + 1),
        _fetch_aq_history(lat, lon, past_days=92),
        _fetch_weather_history(lat, lon, hist_start, hist_end),
    )

    # Weather for target day: from API forecast
    wx_day = wx_forecast_df[wx_forecast_df["time"].dt.date == target_date].copy()
    wx_day = wx_day.reset_index(drop=True)

    # AQ: train ML on history, predict for target day
    merged_hist = pd.merge(wx_hist_df, aq_hist_df, on="time", how="outer").sort_values("time")
    merged_hist = _add_cyclical_features(merged_hist)
    aq_target_cols = [
        c for c in AQ_VARS
        if c in merged_hist.columns and merged_hist[c].notna().sum() > 20
    ]

    aq_day_df = pd.DataFrame()
    if aq_target_cols:
        model  = _get_or_train(lat, lon, merged_hist, aq_target_cols)
        inf_df = _build_inference_frame(target_date)
        Y_pred = model.predict(inf_df[FEATURE_COLS].values)
        aq_day_df = pd.DataFrame(Y_pred, columns=aq_target_cols)
        aq_day_df["time"] = inf_df["time"].values

    # Merge weather (API) + AQ (ML)
    if not aq_day_df.empty and not wx_day.empty:
        day_df = pd.merge(wx_day, aq_day_df, on="time", how="outer")
    elif not wx_day.empty:
        day_df = wx_day
    elif not aq_day_df.empty:
        day_df = aq_day_df
    else:
        day_df = pd.DataFrame()

    available_targets = [c for c in ALL_TARGETS if c in day_df.columns]
    return _summarise(day_df, available_targets, days_ahead,
                      source="ml_aq_api_weather", n_train=len(merged_hist))


async def _predict_ml(lat: float, lon: float,
                       target_date: date, days_ahead: int) -> dict:
    """≥ 17 days: full ML for all variables using 90 days of historical data."""
    today = date.today()
    hist_end   = today - timedelta(days=3)
    hist_start = hist_end - timedelta(days=89)

    wx_hist_df, aq_hist_df = await asyncio.gather(
        _fetch_weather_history(lat, lon, hist_start, hist_end),
        _fetch_aq_history(lat, lon, past_days=92),
    )

    merged = pd.merge(wx_hist_df, aq_hist_df, on="time", how="outer").sort_values("time")
    merged = _add_cyclical_features(merged)

    target_cols = [
        c for c in ALL_TARGETS
        if c in merged.columns and merged[c].notna().sum() > 20
    ]

    if not target_cols:
        logger.warning("No usable target columns for %s %s", lat, lon)
        return {
            "days_ahead": days_ahead, "source": "ml_full",
            "predictions": {}, "hourly_breakdown": [],
            "aqi_category": "Unknown", "data_points_used": len(merged),
        }

    model  = _get_or_train(lat, lon, merged, target_cols)
    inf_df = _build_inference_frame(target_date)
    Y_pred = model.predict(inf_df[FEATURE_COLS].values)
    day_df = pd.DataFrame(Y_pred, columns=target_cols)
    day_df["time"] = inf_df["time"].values

    return _summarise(day_df, target_cols, days_ahead,
                      source="ml_full", n_train=len(merged))


# ═══════════════════════════════════════════════════════════════════════════════
# Public API
# ═══════════════════════════════════════════════════════════════════════════════

async def predict_env_for_date(lat: float, lon: float,
                                target_date: date) -> dict:
    """
    Predict hourly environmental metrics for `target_date` at (lat, lon).

    Returns a dict with keys:
      days_ahead        int
      source            "api_direct" | "ml_aq_api_weather" | "ml_full"
      predictions       {variable: {mean, min, max, p25, p75}}
      hourly_breakdown  list of 24 dicts (one per hour)
      aqi_category      str
      data_points_used  int  (0 for api_direct)
    """
    today      = date.today()
    days_ahead = (target_date - today).days

    try:
        if days_ahead <= 5:
            return await _predict_from_api(lat, lon, target_date, days_ahead)
        if days_ahead <= 16:
            return await _predict_mixed(lat, lon, target_date, days_ahead)
        return await _predict_ml(lat, lon, target_date, days_ahead)

    except Exception as exc:
        logger.error("Forecasting failed for (%s, %s) on %s: %s",
                     lat, lon, target_date, exc, exc_info=True)
        # Return a minimal fallback so the rest of the request doesn't crash
        return {
            "days_ahead":        days_ahead,
            "source":            "error_fallback",
            "predictions":       {},
            "hourly_breakdown":  [],
            "aqi_category":      "Unknown",
            "data_points_used":  0,
        }
