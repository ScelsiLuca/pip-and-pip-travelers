from datetime import date
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base
from app.main import add_stop, delete_stop, reorder_timeline, reset_original, restore_stop, update_route, update_stop
from app.models import ItineraryStop, TripDay
from app.schemas import ReorderRequest, RoutePatch, StopIn, StopPatch
from app.services import get_next_trip_leg, google_destination, seed_database, serialize_day


def seeded():
    engine=create_engine("sqlite://",connect_args={"check_same_thread":False},poolclass=StaticPool)
    Base.metadata.create_all(engine);db=Session(engine);seed_database(db);return db


def day_one(db):return db.scalar(select(TripDay).where(TripDay.day_number==1))


def test_seed_creates_editable_rows_and_preserves_original_backup():
    with seeded() as db:
        day=day_one(db)
        assert len(day.stops)==8 and all(stop.original_key for stop in day.stops)


def test_reorder_persists_and_serialization_uses_custom_order():
    with seeded() as db:
        day=day_one(db);items=list(day.stops);order=[items[1],items[0],*items[2:]]
        reorder_timeline(day.id,ReorderRequest(items=[{"kind":"stop","id":item.id} for item in order]),db)
        db.expire_all();day=day_one(db)
        assert [item["name"] for item in serialize_day(day)["stops"]][:2]==["Pescheria (mercato)","Via Crociferi (via delle chiese)"]


def test_address_edit_persists_without_changing_coordinates():
    with seeded() as db:
        stop=day_one(db).stops[0];before=stop.coordinates
        update_stop(stop.id,StopPatch(address="Via Crociferi, Catania CT, Italia"),db);db.expire_all()
        found=db.get(ItineraryStop,stop.id)
        assert found.address.startswith("Via Crociferi") and found.coordinates==before


def test_coordinates_change_only_when_explicitly_confirmed_in_patch():
    with seeded() as db:
        stop=day_one(db).stops[0];candidate={"lat":37.503,"lon":15.087}
        update_stop(stop.id,StopPatch(coordinates=candidate),db);db.expire_all()
        assert db.get(ItineraryStop,stop.id).coordinates==candidate


def test_google_destination_priority():
    assert google_destination({"lat":1,"lon":2},"Address","Name","City")=="1,2"
    assert google_destination(None,"Address","Name","City")=="Address"
    assert google_destination(None,None,"Name","City")=="Name, City, Italia"


def test_add_soft_delete_and_restore_stop():
    with seeded() as db:
        day=day_one(db);result=add_stop(day.id,StopIn(name="Nuova",city="Catania",address="Via Test"),db)
        delete_stop(result["id"],db);assert db.get(ItineraryStop,result["id"]).archived is True
        restore_stop(result["id"],db);assert db.get(ItineraryStop,result["id"]).archived is False


def test_transfer_can_be_positioned_between_stops_and_persists():
    with seeded() as db:
        day=db.scalar(select(TripDay).where(TripDay.day_number==5));route=day.routes[0]
        sequence=[("stop",day.stops[0].id),("route",route.id),*[("stop",s.id) for s in day.stops[1:]],("route",day.routes[1].id)]
        reorder_timeline(day.id,ReorderRequest(items=[{"kind":kind,"id":ident} for kind,ident in sequence]),db);db.expire_all()
        serialized=serialize_day(db.get(TripDay,day.id));combined=sorted([("stop",x["id"],x["sortOrder"]) for x in serialized["stops"]]+[("route",x["id"],x["sortOrder"]) for x in serialized["routes"]],key=lambda x:x[2])
        assert combined[1][:2]==("route",route.id)


def test_next_trip_leg_follows_reordered_routes():
    with seeded() as db:
        day=db.scalar(select(TripDay).where(TripDay.day_number==5));first,second=day.routes
        reorder_timeline(day.id,ReorderRequest(items=[*[{"kind":"stop","id":s.id} for s in day.stops],{"kind":"route","id":second.id},{"kind":"route","id":first.id}]),db);db.expire_all()
        assert get_next_trip_leg(db,date(2026,8,25))["id"]==second.id


def test_transfer_addresses_are_editable():
    with seeded() as db:
        route=db.scalar(select(TripDay).where(TripDay.day_number==5)).routes[0]
        update_route(route.id,RoutePatch(origin_address="Pillirina, Siracusa",destination_address="Noto, SR"),db);db.expire_all()
        assert db.get(type(route),route.id).destination_address=="Noto, SR"


def test_reset_original_restores_seed_order_safely():
    with seeded() as db:
        day=day_one(db);day.stops[0].sort_order=9999;db.commit();reset_original(db);db.expire_all()
        assert serialize_day(day_one(db))["stops"][0]["name"]=="Via Crociferi (via delle chiese)"
