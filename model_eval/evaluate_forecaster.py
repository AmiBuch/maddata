"""
Evaluate the PurePath environmental time-series forecasting model.

Strategy:
  1. Fetch 90 days of historical data (weather + AQ) from Open-Meteo for a
     set of test cities.
  2. For each horizon (5, 15, 30 days):
       - Split into train (everything before the holdout) and test (the
         holdout day's 24 hourly rows).
       - Train a GradientBoostingRegressor on the train split using the
         same cyclical features as the production forecaster.
       - Predict the holdout day's 24 hourly values.
       - Compare against actual values; compute MAE, RMSE, R2.
  3. Print and save a summary table of accuracy per variable per horizon.

Usage:
    cd maddata
    python -m model_eval.evaluate_forecaster
"""

import asyncio
import sys
import os
from datetime import date, datetime, timedelta
from pathlib import Path

import httpx
import numpy as np
import pandas as pd
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.multioutput import MultiOutputRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

# -- Constants (mirrors forecaster.py) -----------------------------------------

_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
_AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"

WEATHER_VARS = ["temperature_2m", "relative_humidity_2m", "wind_speed_10m", "precipitation"]
AQ_VARS = ["pm2_5", "pm10", "nitrogen_dioxide", "ozone", "us_aqi"]
ALL_TARGETS = WEATHER_VARS + AQ_VARS

FEATURE_COLS = [
    "hour_sin", "hour_cos",
    "dow_sin", "dow_cos",
    "doy_sin", "doy_cos",
    "month_sin", "month_cos",
]

# Cities to evaluate (diverse geography)
TEST_CITIES = [
    {"name": "Chicago",     "lat": 41.88, "lon": -87.63},
    {"name": "Los Angeles",  "lat": 34.05, "lon": -118.24},
    {"name": "New York",     "lat": 40.71, "lon": -74.01},
]

HORIZONS = [5, 15, 30]  # days ahead


# -- Data fetching -------------------------------------------------------------

async def fetch_weather_history(lat: float, lon: float,
                                 start: date, end: date) -> pd.DataFrame:
    params = {
        "latitude": lat, "longitude": lon,
        "start_date": start.isoformat(), "end_date": end.isoformat(),
        "hourly": ",".join(WEATHER_VARS),
        "wind_speed_unit": "mph", "timezone": "auto",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(_ARCHIVE_URL, params=params)
        r.raise_for_status()
        data = r.json()
    hourly = data.get("hourly", {})
    df = pd.DataFrame({"time": pd.to_datetime(hourly.get("time", []))})
    for v in WEATHER_VARS:
        df[v] = hourly.get(v, [None] * len(df))
    return df


async def fetch_aq_history(lat: float, lon: float,
                            past_days: int = 92) -> pd.DataFrame:
    params = {
        "latitude": lat, "longitude": lon,
        "hourly": ",".join(AQ_VARS),
        "past_days": min(past_days, 92),
        "forecast_days": 0,
        "timezone": "auto",
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.get(_AQ_URL, params=params)
        r.raise_for_status()
        data = r.json()
    hourly = data.get("hourly", {})
    df = pd.DataFrame({"time": pd.to_datetime(hourly.get("time", []))})
    for v in AQ_VARS:
        df[v] = hourly.get(v, [None] * len(df))
    return df


# -- Feature engineering (same as forecaster.py) ------------------------------

def add_cyclical_features(df: pd.DataFrame) -> pd.DataFrame:
    t = df["time"]
    hour = t.dt.hour
    dow = t.dt.dayofweek
    doy = t.dt.dayofyear
    mon = t.dt.month
    df = df.copy()
    df["hour_sin"], df["hour_cos"] = np.sin(2*np.pi*hour/24), np.cos(2*np.pi*hour/24)
    df["dow_sin"], df["dow_cos"] = np.sin(2*np.pi*dow/7), np.cos(2*np.pi*dow/7)
    df["doy_sin"], df["doy_cos"] = np.sin(2*np.pi*doy/365), np.cos(2*np.pi*doy/365)
    df["month_sin"], df["month_cos"] = np.sin(2*np.pi*mon/12), np.cos(2*np.pi*mon/12)
    return df


# -- Model training (same config as forecaster.py) ---------------------------

def train_model(train_df: pd.DataFrame, target_cols: list[str]) -> MultiOutputRegressor:
    train_df = train_df.dropna(subset=FEATURE_COLS)
    Y_df = train_df[target_cols].copy()
    for col in target_cols:
        Y_df[col] = Y_df[col].fillna(Y_df[col].median()).clip(lower=0)

    X = train_df[FEATURE_COLS].values
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


# -- Evaluation ----------------------------------------------------------------

def evaluate_horizon(merged: pd.DataFrame, target_cols: list[str],
                     horizon_days: int) -> dict:
    """
    Simulate a forecast `horizon_days` into the future.

    We pick a date that is `horizon_days` before the latest date in the dataset.
    Everything before that date is training data; that day is the test day.
    This simulates: "given data up to day X, predict day X + horizon".
    """
    merged = merged.sort_values("time").reset_index(drop=True)
    merged["date"] = merged["time"].dt.date

    all_dates = sorted(merged["date"].unique())
    if len(all_dates) < horizon_days + 10:
        return {}  # not enough data

    # The test day is `horizon_days` before the end of available data
    # so we can use everything before (end - horizon_days) as training
    test_date = all_dates[-(horizon_days + 1)]
    train_cutoff = test_date - timedelta(days=horizon_days)

    train_df = merged[merged["date"] < train_cutoff].copy()
    test_df = merged[merged["date"] == test_date].copy()

    if len(train_df) < 200 or len(test_df) < 12:
        return {}

    # Filter target columns to those with enough training data
    usable_targets = [
        c for c in target_cols
        if c in train_df.columns and train_df[c].notna().sum() > 20
    ]
    if not usable_targets:
        return {}

    # Train
    model = train_model(train_df, usable_targets)

    # Predict
    X_test = test_df[FEATURE_COLS].values
    Y_pred = model.predict(X_test)
    pred_df = pd.DataFrame(Y_pred, columns=usable_targets, index=test_df.index)

    # Compare with actuals
    results = {}
    for col in usable_targets:
        actual = test_df[col].values
        predicted = pred_df[col].values

        # Drop NaNs in actual
        mask = ~np.isnan(actual)
        if mask.sum() < 5:
            continue

        actual_clean = actual[mask]
        predicted_clean = np.clip(predicted[mask], 0, None)

        mae = mean_absolute_error(actual_clean, predicted_clean)
        rmse = np.sqrt(mean_squared_error(actual_clean, predicted_clean))
        r2 = r2_score(actual_clean, predicted_clean) if len(actual_clean) > 2 else float("nan")

        # Also compute MAPE (mean absolute percentage error), ignoring zeros
        nonzero = actual_clean != 0
        if nonzero.sum() > 0:
            mape = np.mean(np.abs((actual_clean[nonzero] - predicted_clean[nonzero]) / actual_clean[nonzero])) * 100
        else:
            mape = float("nan")

        results[col] = {
            "MAE": round(mae, 3),
            "RMSE": round(rmse, 3),
            "R2": round(r2, 4),
            "MAPE%": round(mape, 2),
            "actual_mean": round(float(np.mean(actual_clean)), 2),
            "pred_mean": round(float(np.mean(predicted_clean)), 2),
            "n_points": int(mask.sum()),
        }

    return results


async def evaluate_city(city: dict) -> dict:
    """Run evaluation for a single city across all horizons."""
    name, lat, lon = city["name"], city["lat"], city["lon"]
    print(f"\n{'='*60}")
    print(f"  Evaluating: {name} ({lat}, {lon})")
    print(f"{'='*60}")

    # Fetch ~90 days of history
    today = date.today()
    hist_end = today - timedelta(days=3)  # archive lag buffer
    hist_start = hist_end - timedelta(days=89)

    print(f"  Fetching data: {hist_start} to {hist_end} ...")
    try:
        wx_df, aq_df = await asyncio.gather(
            fetch_weather_history(lat, lon, hist_start, hist_end),
            fetch_aq_history(lat, lon, past_days=92),
        )
    except Exception as e:
        print(f"  ERROR fetching data: {e}")
        return {}

    merged = pd.merge(wx_df, aq_df, on="time", how="outer").sort_values("time")
    merged = add_cyclical_features(merged)
    print(f"  Total data points: {len(merged)} hourly rows")
    print(f"  Date range: {merged['time'].min()} to {merged['time'].max()}")

    # Show data completeness
    for v in ALL_TARGETS:
        if v in merged.columns:
            pct = merged[v].notna().mean() * 100
            print(f"    {v:25s}: {pct:5.1f}% complete")

    city_results = {}
    for horizon in HORIZONS:
        print(f"\n  --- Horizon: {horizon} days ---")
        results = evaluate_horizon(merged, ALL_TARGETS, horizon)
        if not results:
            print(f"    (insufficient data for {horizon}-day horizon)")
            continue
        city_results[horizon] = results
        for var, metrics in results.items():
            print(f"    {var:25s}  MAE={metrics['MAE']:8.3f}  RMSE={metrics['RMSE']:8.3f}  "
                  f"R2={metrics['R2']:7.4f}  MAPE={metrics['MAPE%']:6.2f}%  "
                  f"(actual={metrics['actual_mean']:.1f}, pred={metrics['pred_mean']:.1f})")

    return city_results


def build_summary_table(all_results: dict) -> pd.DataFrame:
    """Build a summary DataFrame averaging across cities."""
    rows = []
    for horizon in HORIZONS:
        for var in ALL_TARGETS:
            maes, rmses, r2s, mapes = [], [], [], []
            for city_name, city_res in all_results.items():
                if horizon in city_res and var in city_res[horizon]:
                    m = city_res[horizon][var]
                    maes.append(m["MAE"])
                    rmses.append(m["RMSE"])
                    r2s.append(m["R2"])
                    if not np.isnan(m["MAPE%"]):
                        mapes.append(m["MAPE%"])

            if maes:
                rows.append({
                    "Horizon (days)": horizon,
                    "Variable": var,
                    "MAE": round(np.mean(maes), 3),
                    "RMSE": round(np.mean(rmses), 3),
                    "R2": round(np.mean(r2s), 4),
                    "MAPE%": round(np.mean(mapes), 2) if mapes else float("nan"),
                    "n_cities": len(maes),
                })

    return pd.DataFrame(rows)


async def main():
    print("=" * 60)
    print("  PurePath Environmental Forecaster -- Model Evaluation")
    print("=" * 60)
    print(f"  Date: {date.today().isoformat()}")
    print(f"  Horizons: {HORIZONS} days")
    print(f"  Cities: {[c['name'] for c in TEST_CITIES]}")
    print(f"  Variables: {ALL_TARGETS}")
    print(f"  Model: GradientBoostingRegressor (n_estimators=60, max_depth=3)")

    all_results = {}
    for city in TEST_CITIES:
        all_results[city["name"]] = await evaluate_city(city)

    # Build and display summary
    summary = build_summary_table(all_results)
    if summary.empty:
        print("\nNo results to summarise.")
        return

    print("\n" + "=" * 80)
    print("  SUMMARY -- Average Accuracy Across Cities")
    print("=" * 80)

    for horizon in HORIZONS:
        h_df = summary[summary["Horizon (days)"] == horizon]
        if h_df.empty:
            continue
        print(f"\n  +--- {horizon}-Day Horizon " + "-" * 45 + "+")
        print(f"  | {'Variable':25s} | {'MAE':>8s} | {'RMSE':>8s} | {'R2':>8s} | {'MAPE%':>8s} |")
        print(f"  +{'-'*27}+{'-'*10}+{'-'*10}+{'-'*10}+{'-'*10}+")
        for _, row in h_df.iterrows():
            mape_str = f"{row['MAPE%']:8.2f}" if not np.isnan(row['MAPE%']) else "     N/A"
            print(f"  | {row['Variable']:25s} | {row['MAE']:8.3f} | {row['RMSE']:8.3f} | "
                  f"{row['R2']:8.4f} | {mape_str} |")
        print(f"  +{'-'*27}+{'-'*10}+{'-'*10}+{'-'*10}+{'-'*10}+")

    # Save results
    out_dir = Path(__file__).parent
    csv_path = out_dir / "forecast_accuracy_results.csv"
    summary.to_csv(csv_path, index=False)
    print(f"\n  Results saved to: {csv_path}")

    # Also save detailed per-city results
    detail_rows = []
    for city_name, city_res in all_results.items():
        for horizon, var_res in city_res.items():
            for var, metrics in var_res.items():
                detail_rows.append({
                    "City": city_name,
                    "Horizon (days)": horizon,
                    "Variable": var,
                    **metrics,
                })
    if detail_rows:
        detail_df = pd.DataFrame(detail_rows)
        detail_path = out_dir / "forecast_accuracy_detailed.csv"
        detail_df.to_csv(detail_path, index=False)
        print(f"  Detailed results saved to: {detail_path}")


if __name__ == "__main__":
    asyncio.run(main())
