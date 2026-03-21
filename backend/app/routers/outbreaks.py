from datetime import datetime, timezone
from fastapi import APIRouter, Query
from app.models.schemas import OutbreakFeedResponse
from app.services.outbreak_tracker import fetch_outbreaks

router = APIRouter()


@router.get("/", response_model=OutbreakFeedResponse)
async def get_outbreaks(city: str = Query(..., description="City name to search outbreaks for")):
    reports = await fetch_outbreaks(city)
    return OutbreakFeedResponse(
        city=city,
        reports=reports,
        last_updated=datetime.now(timezone.utc),
    )
