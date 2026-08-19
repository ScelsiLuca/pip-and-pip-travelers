import asyncio
from datetime import date

from app import main
from app.services import seed_database
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base


def memory_db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return Session(engine)


async def _call_dashboard(db, target):
    return await main.dashboard_today(target_date=target, latitude=None, longitude=None, live_source="SIMULATION", db=db)


def test_alert_coverage_full_when_traffic_configured_and_live():
    with memory_db() as db:
        seed_database(db)
        async def fake_tomtom(db_arg, origin, destination):
            return {"provider":"TomTom Routing API","dataState":"LIVE"}
        # patch the function used by main
        main.tomtom_route = fake_tomtom
        # provide a leg so tomtom_route is invoked
        main.get_next_trip_leg = lambda db_arg, eff_date: {"originCoordinates": {"lat": 37.5, "lon": 15.1}, "destinationCoordinates": {"lat": 37.4, "lon": 15.2}}
        result = asyncio.run(_call_dashboard(db, date(2026, 8, 21)))
        assert result["alertCoverage"]["traffic"] == "LIVE"


def test_sea_day_etna_unavailable_on_25aug():
    # 25/08 is outside the Etna 72h window relative to 23/08 -> etna should be UNAVAILABLE
    with memory_db() as db:
        seed_database(db)
        result = asyncio.run(_call_dashboard(db, date(2026, 8, 25)))
        assert result["alertCoverage"]["etna"] == "UNAVAILABLE"
