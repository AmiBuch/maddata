"""
Extract restaurants from Yelp academic dataset.
Filters: Minnesota (MN), Illinois (IL), Wisconsin (WI)
Keeps: name, city, state, stars, categories
Outputs first 200 to backend/app/data/restaurants.json
"""
import json
from pathlib import Path

# Paths
SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
YELP_PATH = PROJECT_ROOT / "backend" / "app" / "yelpdata" / "yelp_academic_dataset_business.json"
OUTPUT_PATH = PROJECT_ROOT / "backend" / "app" / "data" / "restaurants.json"

TARGET_STATES = {"MN", "IL", "WI"}
MAX_RESULTS = 200


def main():
    if not YELP_PATH.exists():
        print(f"Error: Yelp file not found at {YELP_PATH}")
        return 1

    results = []
    with open(YELP_PATH, encoding="utf-8") as f:
        for line in f:
            if len(results) >= MAX_RESULTS:
                break
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
            except json.JSONDecodeError:
                continue

            # Filter by state
            state = (obj.get("state") or "").strip().upper()
            if state not in TARGET_STATES:
                continue

            # Filter for restaurants (categories can be string or list)
            categories = obj.get("categories") or ""
            if isinstance(categories, list):
                cat_str = ", ".join(categories)
            else:
                cat_str = str(categories)
            if "Restaurant" not in cat_str:
                continue

            results.append({
                "name": obj.get("name", ""),
                "city": obj.get("city", ""),
                "state": state,
                "stars": obj.get("stars"),
                "categories": cat_str,
            })

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"Saved {len(results)} restaurants to {OUTPUT_PATH}")
    return 0


if __name__ == "__main__":
    exit(main())
