import pytest
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.services import seed_database, current_trip_context
from app.main import dashboard_today


def memory_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    return Session(engine)


@pytest.mark.asyncio
async def test_alert_coverage_full_on_normal_day_with_live_weather(monkeypatch):
    """Normal day: weather=LIVE, traffic=NOT_CONFIGURED, etna=CACHE, marine irrelevant -> FULL"""

    with memory_db() as db:
        seed_database(db)

        async def fake_weather(*args):
            return {
                "dataState": "LIVE",
                "current": {"temperature_2m": 25},
                "updatedAt": "2026-08-21T10:00:00Z",
            }

        monkeypatch.setattr("app.main.weather", fake_weather)

        async def fake_tomtom(*args):
            return {"dataState": "NOT_CONFIGURED"}

        monkeypatch.setattr("app.main.tomtom_route", fake_tomtom)

        async def fake_etna(*args):
            return {
                "dataState": "CACHE",
                "title": "Etna Update",
            }

        monkeypatch.setattr("app.main.etna_latest", fake_etna)

        async def fake_sea(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.sea", fake_sea)

        async def fake_osrm(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.osrm_route", fake_osrm)

        async def fake_reverse(*args):
            return "Catania"

        monkeypatch.setattr("app.main.reverse_geocode", fake_reverse)

        result = await dashboard_today(
            target_date=date(2026, 8, 21),
            latitude=37.5,
            longitude=15.1,
            live_source="GPS",
            db=db,
        )

        assert result["alertCoverageState"] == "FULL"
        assert result["alertCoverage"]["weather"] == "LIVE"
        assert result["alertCoverage"]["etna"] == "CACHE"
        assert result["alertCoverage"]["traffic"] == "NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_alert_coverage_full_on_etna_day_with_cached_etna(monkeypatch):
    """Etna-relevant day: weather=LIVE, etna=CACHE, traffic=NOT_CONFIGURED -> FULL"""

    with memory_db() as db:
        seed_database(db)

        async def fake_weather(*args):
            return {
                "dataState": "LIVE",
                "current": {"temperature_2m": 25},
                "updatedAt": "2026-08-22T10:00:00Z",
            }

        monkeypatch.setattr("app.main.weather", fake_weather)

        async def fake_tomtom(*args):
            return {"dataState": "NOT_CONFIGURED"}

        monkeypatch.setattr("app.main.tomtom_route", fake_tomtom)

        async def fake_etna(*args):
            return {
                "dataState": "CACHE",
                "title": "Etna Update",
            }

        monkeypatch.setattr("app.main.etna_latest", fake_etna)

        async def fake_sea(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.sea", fake_sea)

        async def fake_osrm(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.osrm_route", fake_osrm)

        async def fake_reverse(*args):
            return "Etna"

        monkeypatch.setattr("app.main.reverse_geocode", fake_reverse)

        result = await dashboard_today(
            target_date=date(2026, 8, 23),
            latitude=37.7,
            longitude=14.9,
            live_source="GPS",
            db=db,
        )

        assert result["alertCoverageState"] == "FULL"
        assert result["alertCoverage"]["weather"] == "LIVE"
        assert result["alertCoverage"]["etna"] == "CACHE"
        assert result["alertCoverage"]["traffic"] == "NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_alert_coverage_partial_when_weather_unavailable(monkeypatch):
    """Relevant service failure: weather=UNAVAILABLE -> PARTIAL"""

    with memory_db() as db:
        seed_database(db)

        async def fake_weather(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.weather", fake_weather)

        async def fake_tomtom(*args):
            return {"dataState": "NOT_CONFIGURED"}

        monkeypatch.setattr("app.main.tomtom_route", fake_tomtom)

        async def fake_etna(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.etna_latest", fake_etna)

        async def fake_sea(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.sea", fake_sea)

        async def fake_osrm(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.osrm_route", fake_osrm)

        async def fake_reverse(*args):
            return "Catania"

        monkeypatch.setattr("app.main.reverse_geocode", fake_reverse)

        result = await dashboard_today(
            target_date=date(2026, 8, 21),
            latitude=37.5,
            longitude=15.1,
            live_source="GPS",
            db=db,
        )

        assert result["alertCoverageState"] == "PARTIAL"
        assert result["alertCoverage"]["weather"] == "UNAVAILABLE"


@pytest.mark.asyncio
async def test_alert_coverage_full_when_traffic_configured_and_live(monkeypatch):
    """Weather=LIVE, Etna=CACHE and configured traffic=LIVE -> FULL"""

    with memory_db() as db:
        seed_database(db)

        async def fake_weather(*args):
            return {
                "dataState": "LIVE",
                "current": {"temperature_2m": 25},
                "updatedAt": "2026-08-21T10:00:00Z",
            }

        monkeypatch.setattr("app.main.weather", fake_weather)

        async def fake_etna(*args):
            return {
                "dataState": "CACHE",
                "title": "Etna Update",
            }

        monkeypatch.setattr("app.main.etna_latest", fake_etna)

        async def fake_sea(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.sea", fake_sea)

        async def fake_osrm(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.osrm_route", fake_osrm)

        async def fake_reverse(*args):
            return "Catania"

        monkeypatch.setattr("app.main.reverse_geocode", fake_reverse)

        async def fake_tomtom_leg(*args):
            return {"dataState": "LIVE"}

        monkeypatch.setattr("app.main.tomtom_route", fake_tomtom_leg)

        monkeypatch.setattr(
            "app.main.get_next_trip_leg",
            lambda db_arg, eff_date: {
                "originCoordinates": {
                    "lat": 37.5,
                    "lon": 15.1,
                },
                "destinationCoordinates": {
                    "lat": 37.4,
                    "lon": 15.2,
                },
            },
        )

        result = await dashboard_today(
            target_date=date(2026, 8, 21),
            latitude=37.5,
            longitude=15.1,
            live_source="GPS",
            db=db,
        )

        assert result["alertCoverageState"] == "FULL"
        assert result["alertCoverage"]["weather"] == "LIVE"
        assert result["alertCoverage"]["etna"] == "CACHE"
        assert result["alertCoverage"]["traffic"] == "LIVE"


@pytest.mark.asyncio
async def test_alert_coverage_partial_on_sea_day_with_unavailable_marine(monkeypatch):
    """Sea day with marine=UNAVAILABLE -> PARTIAL"""

    with memory_db() as db:
        seed_database(db)

        async def fake_weather(*args):
            return {
                "dataState": "LIVE",
                "current": {"temperature_2m": 25},
                "updatedAt": "2026-08-25T10:00:00Z",
            }

        monkeypatch.setattr("app.main.weather", fake_weather)

        async def fake_tomtom(*args):
            return {"dataState": "NOT_CONFIGURED"}

        monkeypatch.setattr("app.main.tomtom_route", fake_tomtom)

        async def fake_etna(*args):
            return {
                "dataState": "CACHE",
                "title": "Etna Update",
            }

        monkeypatch.setattr("app.main.etna_latest", fake_etna)

        async def fake_sea(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.sea", fake_sea)

        async def fake_osrm(*args):
            return {"dataState": "UNAVAILABLE"}

        monkeypatch.setattr("app.main.osrm_route", fake_osrm)

        async def fake_reverse(*args):
            return "Pillirina"

        monkeypatch.setattr("app.main.reverse_geocode", fake_reverse)

        original_context = current_trip_context

        def fake_context_wrapper(db, target_date=None):
            if target_date:
                effective_now = datetime.combine(
                    target_date,
                    datetime.now().time(),
                    tzinfo=ZoneInfo("Europe/Rome"),
                )
            else:
                effective_now = None

            ctx = original_context(db, effective_now)

            if target_date == date(2026, 8, 25):
                ctx["activityType"] = "boat_trip"

            return ctx

        monkeypatch.setattr(
            "app.main.current_trip_context",
            fake_context_wrapper,
        )

        result = await dashboard_today(
            target_date=date(2026, 8, 25),
            latitude=36.8,
            longitude=15.2,
            live_source="GPS",
            db=db,
        )

        assert result["alertCoverageState"] == "PARTIAL"
        assert result["alertCoverage"]["weather"] == "LIVE"
        assert result["alertCoverage"]["etna"] == "UNAVAILABLE"
        assert result["alertCoverage"]["marine"] == "UNAVAILABLE"