from datetime import date, datetime
from zoneinfo import ZoneInfo
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.database import Base
from app.models import Activity, TripDay
from app.providers import parse_ingv_latest
from app.services import current_trip_context, get_next_trip_leg, navigation_origin, seed_database, serialize_day


def memory_db():
    engine=create_engine("sqlite://",connect_args={"check_same_thread":False},poolclass=StaticPool)
    Base.metadata.create_all(engine)
    return Session(engine)


def test_real_seed_from_pdf():
    with memory_db() as db:
        seed_database(db)
        days=db.scalars(select(TripDay).order_by(TripDay.day_number)).all()
        assert len(days)==15
        assert days[0].title=="Catania"
        assert days[2].routes[0].destination=="Siracusa"
        assert any(a.title=="Pillirina boat tour" for a in days[4].activities)
        assert days[8].activities==[]


def test_context_resolver_uses_activity_location():
    with memory_db() as db:
        seed_database(db)
        ctx=current_trip_context(db,datetime(2026,8,23,9,tzinfo=ZoneInfo("Europe/Rome")))
        assert ctx["day"]==3
        assert ctx["primaryLocation"]=="Etna"
        assert ctx["nextLocation"]=="Siracusa"
        assert ctx["activityType"]=="etna"


def test_effective_date_contexts_entire_home():
    with memory_db() as db:
        seed_database(db)
        etna=current_trip_context(db,target_date=datetime(2026,8,23).date())
        assert etna["dayNumber"]==3
        assert etna["primaryLocation"]=="Etna"
        assert etna["nextActivity"]["title"]=="Escursione Etna"
        assert etna["nextRoute"]["origin"]=="Etna"
        assert etna["nextRoute"]["destination"]=="Siracusa"
        assert etna["coordinates"] is not None
        assert etna["activityType"]=="etna"
        sea_ctx=current_trip_context(db,target_date=datetime(2026,8,30).date())
        assert sea_ctx["dayNumber"]==10
        assert sea_ctx["nextActivity"]["title"]=="Boat tour Favignana"
        assert sea_ctx["activityType"] in {"sea","boat_trip"}


def test_seed_has_routable_coordinates():
    with memory_db() as db:
        seed_database(db)
        day=db.scalar(select(TripDay).where(TripDay.day_number==3))
        assert day.routes[0].origin_coordinates["lat"]
        assert day.routes[0].destination_coordinates["lon"]


def test_ingv_parser_preserves_objective_wording():
    page="""<h2>COMUNICATO DI ATTIVITA' VULCANICA - ETNA (AGGIORNAMENTO n. 5)
    del 02-08-2026 11:04 (UTC)</h2><p>Le reti di monitoraggio hanno registrato un aggiornamento.</p>
    <h3>ARCHIVIO AGGIORNAMENTI</h3>"""
    parsed=parse_ingv_latest(page)
    assert parsed and parsed["timestamp"]=="02-08-2026 11:04 UTC"
    assert "monitoraggio" in parsed["summary"]


def test_activity_status_is_not_inferred_from_date():
    with memory_db() as db:
        seed_database(db)
        day=db.scalar(select(TripDay).where(TripDay.day_number==1))
        assert serialize_day(day)["activities"][0]["status"]=="planned"


def test_next_trip_leg_across_itinerary():
    with memory_db() as db:
        seed_database(db)
        cases={date(2026,8,21):("Catania","Taormina","INTER_DAY"),date(2026,8,23):("Etna","Siracusa","PLANNED"),
            date(2026,8,24):("Siracusa","Pillirina","INTER_DAY"),
            date(2026,8,25):("Pillirina","Noto","PLANNED"),date(2026,8,28):("Agrigento","Gibellina","PLANNED"),
            date(2026,8,31):("Trapani","San Vito Lo Capo","PLANNED")}
        for target,expected in cases.items():
            leg=get_next_trip_leg(db,target)
            assert (leg["origin"],leg["destination"],leg["kind"])==expected


def test_simulated_position_cannot_change_trip_chronology():
    with memory_db() as db:
        seed_database(db)
        before=get_next_trip_leg(db,date(2026,8,24))
        # Navigation coordinates are deliberately independent from the chronological resolver.
        day=db.scalar(select(TripDay).where(TripDay.day_number==4));activity=day.activities[0]
        assert navigation_origin(day,activity,36.7422,15.1174)["type"]=="GPS"
        after=get_next_trip_leg(db,date(2026,8,24))
        assert (before["origin"],before["destination"],before["kind"]) == (after["origin"],after["destination"],after["kind"])
