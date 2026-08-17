from datetime import datetime
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import TripDay
from app.providers import decode_google_polyline, duration_seconds, traffic_delay_minutes
from app.services import (get_next_activity, google_maps_url, haversine_km,
    leave_now, navigation_origin, seed_database)


def seeded():
    engine=create_engine("sqlite://",connect_args={"check_same_thread":False},poolclass=StaticPool)
    Base.metadata.create_all(engine);db=Session(engine);seed_database(db);return db


def test_gps_origin_precedence():
    with seeded() as db:
        day=db.scalar(select(TripDay).where(TripDay.day_number==3));activity=day.activities[0]
        assert navigation_origin(day,activity,37.1,15.1)["type"]=="GPS"


def test_planned_location_fallback():
    with seeded() as db:
        day=db.scalar(select(TripDay).where(TripDay.day_number==3));activity=day.activities[0]
        assert navigation_origin(day,activity,None,None)["type"]=="PLANNED_LOCATION"


def test_next_activity_excludes_completed():
    with seeded() as db:
        day=db.scalar(select(TripDay).where(TripDay.day_number==5));day.activities[0].status="completed"
        found=get_next_activity(day,datetime(2026,8,25,12,tzinfo=ZoneInfo("Europe/Rome")))
        assert found.title=="Visita di Noto"


def test_untimed_activity_is_not_skipped_by_clock():
    with seeded() as db:
        day=db.scalar(select(TripDay).where(TripDay.day_number==3))
        assert get_next_activity(day,datetime(2026,8,23,23,59,tzinfo=ZoneInfo("Europe/Rome"))).title=="Escursione Etna"


def test_distance_conversion():
    assert 110 < haversine_km({"lat":0,"lon":0},{"lat":1,"lon":0}) < 112


def test_google_duration_and_traffic_delay():
    assert duration_seconds("3060s")==3060
    assert traffic_delay_minutes(3300,2760)==9
    assert traffic_delay_minutes(None,2760) is None


def test_no_traffic_fallback_is_explicit():
    assert traffic_delay_minutes(None,None) is None


def test_google_maps_url_with_and_without_gps():
    destination={"lat":37.75,"lon":14.99};gps={"type":"GPS","lat":37.5,"lon":15.1}
    with_origin=parse_qs(urlparse(google_maps_url(destination,gps)).query)
    without=parse_qs(urlparse(google_maps_url(destination,None)).query)
    assert with_origin["origin"]==["37.5,15.1"] and "origin" not in without


def test_google_polyline_decode():
    assert decode_google_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")[0]==[-120.2,38.5]


def test_leave_now_uses_routed_duration_from_gps_flow():
    tz=ZoneInfo("Europe/Rome")
    result=leave_now(datetime(2026,8,23,10,30,tzinfo=tz),58,0,20,datetime(2026,8,23,9,tzinfo=tz))
    assert result["departureSuggested"].endswith("09:12:00+02:00")
