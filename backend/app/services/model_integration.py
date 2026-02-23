"""Integration between the forecaster and the weekly county model.

- Aggregate a single day's hourly forecast into the features expected by
  the weekly model (mean/max/min/diff/sums where appropriate).
- Load a persisted pipeline (joblib) and return a JSON-safe response that
  includes the aggregated env features, raw hourly, and the model prediction
  when available.

The code is defensive: it searches a few candidate model paths, handles
missing lag data, pads/truncates the feature vector to match the saved
pipeline's expected input size, and sanitizes numpy/NaN values before
returning to FastAPI.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Dict

import joblib
import numpy as np
import pandas as pd

from ..services import forecaster

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[3]
COOK_MODEL_PATH = PROJECT_ROOT / "cook_model.joblib"
RESPIRATORY_MODEL_PATH = PROJECT_ROOT / "respiratory_risk_model.joblib"


def _candidate_model_paths(fips: str | None = None, city: str | None = None) -> list[Path]:
    cands: list[Path] = []
    city_norm = (city or "").strip().lower()
    is_chicago = city_norm == "chicago" or city_norm.startswith("chicago,") or fips == "17031"

    if is_chicago:
        cands.append(COOK_MODEL_PATH)
        cands.append(RESPIRATORY_MODEL_PATH)
    else:
        cands.append(RESPIRATORY_MODEL_PATH)
        cands.append(COOK_MODEL_PATH)

    return cands


# Features expected by the county model (training used these + 1-week lags)
FEATURE_ORDER = [
    "temperature_2m_mean",
    "temperature_2m_max",
    "temperature_2m_min",
    "temp_diff",
    "relative_humidity_2m_mean",
    "wind_speed_10m_max",
    "precipitation_sum",
    "pm2_5",
    "pm10",
    "nitrogen_dioxide",
    "sulphur_dioxide",
    "carbon_monoxide",
    "ozone",
    "us_aqi",
    # lags
    "pm25_lag_1",
    "temp_lag_1",
    "humidity_lag_1",
]


def _hourly_list_to_df(hourly_list: list[dict]) -> pd.DataFrame:
    if not hourly_list:
        return pd.DataFrame()
    return pd.DataFrame(hourly_list)


def aggregate_day_to_features(hourly_df: pd.DataFrame) -> Dict[str, float]:
    out: Dict[str, float] = {k: float(np.nan) for k in FEATURE_ORDER}
    if hourly_df.empty:
        return out

    if "temperature_2m" in hourly_df.columns:
        temps = hourly_df["temperature_2m"].dropna()
        if not temps.empty:
            out["temperature_2m_mean"] = float(temps.mean())
            out["temperature_2m_max"] = float(temps.max())
            out["temperature_2m_min"] = float(temps.min())
            out["temp_diff"] = float(temps.max() - temps.min())

    if "relative_humidity_2m" in hourly_df.columns:
        rh = hourly_df["relative_humidity_2m"].dropna()
        if not rh.empty:
            out["relative_humidity_2m_mean"] = float(rh.mean())

    if "wind_speed_10m" in hourly_df.columns:
        ws = hourly_df["wind_speed_10m"].dropna()
        if not ws.empty:
            out["wind_speed_10m_max"] = float(ws.max())

    if "precipitation" in hourly_df.columns:
        pr = hourly_df["precipitation"].dropna()
        if not pr.empty:
            out["precipitation_sum"] = float(pr.sum())

    for col in ("pm2_5", "pm10", "nitrogen_dioxide", "sulphur_dioxide", "carbon_monoxide", "ozone", "us_aqi"):
        if col in hourly_df.columns:
            vals = hourly_df[col].dropna()
            if not vals.empty:
                out[col] = float(vals.mean())

    return out


def _load_model(fips: str | None = None, city: str | None = None):
    for p in _candidate_model_paths(fips, city):
        if p.exists():
            try:
                logger.info("Loading model from %s", p)
                return joblib.load(p), p
            except Exception:
                logger.exception("Failed to load model at %s", p)
                continue
    logger.warning(
        "No usable model file found for city=%s fips=%s; checked %s",
        city,
        fips,
        [str(p) for p in _candidate_model_paths(fips, city)],
    )
    return None, None


def _expected_n_features(model) -> int | None:
    if model is None:
        return None
    # sklearn pipeline/estimator stores n_features_in_
    if hasattr(model, "n_features_in_"):
        try:
            return int(getattr(model, "n_features_in_"))
        except Exception:
            pass
    # pipeline: check individual steps
    steps = getattr(model, "named_steps", None)
    if steps and isinstance(steps, dict):
        for step in steps.values():
            if hasattr(step, "n_features_in_"):
                try:
                    return int(getattr(step, "n_features_in_"))
                except Exception:
                    continue
    return None


def _sanitize_for_json(obj: Any) -> Any:
    # pandas NA
    try:
        if pd.isna(obj):
            return None
    except Exception:
        pass

    if obj is None:
        return None
    if isinstance(obj, (np.floating, float)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    if isinstance(obj, (np.bool_, bool)):
        return bool(obj)
    if isinstance(obj, (list, tuple)):
        return [_sanitize_for_json(x) for x in obj]
    if isinstance(obj, dict):
        return {str(k): _sanitize_for_json(v) for k, v in obj.items()}
    if isinstance(obj, np.ndarray):
        return [_sanitize_for_json(x) for x in obj.tolist()]
    # fallback: try to extract python scalar
    if hasattr(obj, "item"):
        try:
            return _sanitize_for_json(obj.item())
        except Exception:
            pass
    return obj


def _safe_predict(model, arr: np.ndarray) -> np.ndarray:
    """Call model.predict, bypassing sklearn Pipeline if __sklearn_tags__ is broken.

    Older XGBoost pickles can fail with sklearn 1.6+ because the deserialized
    XGBRegressor's __sklearn_tags__ method raises AttributeError.  In that case
    we manually run each pipeline step and use the XGBoost Booster directly.
    """
    try:
        return model.predict(arr)
    except AttributeError as exc:
        if "__sklearn_tags__" not in str(exc):
            raise
        logger.warning("Pipeline.predict() hit __sklearn_tags__ error; falling back to manual steps")

    # Manual pipeline execution
    import xgboost as xgb_lib

    steps = getattr(model, "steps", None)
    if not steps:
        raise RuntimeError("Model is not a Pipeline and predict() failed")

    X = arr
    for name, step in steps[:-1]:  # all transform steps
        X = step.transform(X)

    # Last step is the XGBRegressor — use its booster directly
    last_step = steps[-1][1]
    booster = last_step.get_booster()
    dmat = xgb_lib.DMatrix(X)
    return booster.predict(dmat)


async def predict_percent_visits_for_date(
    lat: float,
    lon: float,
    target_date: date,
    fips: str = "17031",
    city: str | None = None,
) -> Dict[str, Any]:
    resp = await forecaster.predict_env_for_date(lat, lon, target_date)
    hourly = resp.get("hourly_breakdown", [])
    hourly_df = _hourly_list_to_df(hourly)

    features = aggregate_day_to_features(hourly_df)

    # compute 1-week lag features from target_date - 7
    try:
        prev = target_date - timedelta(days=7)
        prev_resp = await forecaster.predict_env_for_date(lat, lon, prev)
        prev_hourly = prev_resp.get("hourly_breakdown", [])
        prev_feats = aggregate_day_to_features(_hourly_list_to_df(prev_hourly))
        features["pm25_lag_1"] = prev_feats.get("pm2_5", float(np.nan))
        features["temp_lag_1"] = prev_feats.get("temperature_2m_mean", float(np.nan))
        features["humidity_lag_1"] = prev_feats.get("relative_humidity_2m_mean", float(np.nan))
    except Exception:
        logger.exception("Failed to compute lag features; proceeding with NaN lags")

    X = [features.get(k, float(np.nan)) for k in FEATURE_ORDER]

    model, model_path = _load_model(fips, city)
    model_pred = None
    model_present = model is not None

    if model_present:
        try:
            expected = _expected_n_features(model)
            if expected is not None:
                got = len(X)
                if got < expected:
                    logger.warning("Feature length mismatch: model expects %s but got %s — padding with NaN", expected, got)
                    X.extend([float(np.nan)] * (expected - got))
                elif got > expected:
                    logger.warning("Feature length mismatch: model expects %s but got %s — truncating", expected, got)
                    X = X[:expected]

            arr = np.asarray([X], dtype=float)
            pred = _safe_predict(model, arr)
            if hasattr(pred, "shape") and pred.shape:
                model_pred = float(np.array(pred).ravel()[0])
            else:
                model_pred = float(pred)
        except Exception:
            logger.exception("Model prediction failed")
            model_pred = None

    result = {
        "env_features": features,
        "model_prediction": model_pred,
        "percent_visits_combined": model_pred,
        "model_present": bool(model_present),
        "model_path": str(model_path) if model_path else None,
        "raw_hourly": hourly,
        "meta": {
            "source": resp.get("source"),
            "days_ahead": resp.get("days_ahead"),
            "fips": fips,
            "city": city,
        },
    }

    return _sanitize_for_json(result)


# synchronous wrapper
def predict_percent_visits_for_date_sync(
    lat: float,
    lon: float,
    target_date: date,
    fips: str = "17031",
    city: str | None = None,
) -> Dict[str, Any]:
    return asyncio.get_event_loop().run_until_complete(
        predict_percent_visits_for_date(lat, lon, target_date, fips, city)
    )
