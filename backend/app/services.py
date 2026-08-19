import asyncio
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
import json
from math import asin, cos, radians, sin, sqrt
from urllib.parse import urlencode
import httpx
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from .config import settings
from .models import Activity, CacheEntry, ChecklistItem, ItineraryStop, Route, SavedPlace, TripDay

ROME = ZoneInfo("Europe/Rome")
TRIP_START = date(2026, 8, 21)
TRIP_END = date(2026, 9, 4)

CITY_RANGES: dict[int, list[tuple[str, int, int]]] = {
    1:[("Catania",0,8)],2:[("Taormina",0,6)],4:[("Ortigia",0,7),("Siracusa",7,11)],
    5:[("Pillirina",0,1),("Noto",1,8),("Marzamemi",8,11)],
    6:[("Ragusa",0,5),("Ragusa Ibla",5,12),("Modica",12,16),("Scicli",16,25),("Valle dei Templi",25,26)],
    7:[("Agrigento",0,8),("Scala dei Turchi",8,9)],8:[("Gibellina",0,2),("Trapani",2,3)],
    10:[("Favignana",0,1)],11:[("San Vito Lo Capo",0,1)],13:[("Riserva dello Zingaro",0,1)],
}


def stop_city(day: TripDay, index: int) -> str:
    for city, start, end in CITY_RANGES.get(day.day_number, []):
        if start <= index < end:
            return city
    return day.base_city or day.title or f"Giorno {day.day_number}"


def ensure_editable_itinerary(db: Session) -> None:
    """One-way, idempotent import of the immutable PDF seed into editable rows."""
    if (db.scalar(select(func.count(ItineraryStop.id))) or 0) > 0:
        return
    days = db.scalars(select(TripDay).order_by(TripDay.day_number)).unique().all()
    for day in days:
        for index, item in enumerate(day.points_of_interest or []):
            db.add(ItineraryStop(
                trip_day_id=day.id, name=item["name"], city=stop_city(day,index), item_type=item.get("category") or "poi",
                address=item.get("address"), coordinates=item.get("coordinates"), sort_order=(index+1)*100,
                original_key=f"day-{day.day_number}-poi-{index}",
            ))
        for route in day.routes:
            destination_index=next((i for i,item in enumerate(day.points_of_interest or [])
                if stop_city(day,i).casefold()==route.destination.casefold()),len(day.points_of_interest or []))
            route.sort_order=max(50,destination_index*100+50)
    db.commit()


def trip_day_number(value: date) -> int | None:
    if not TRIP_START <= value <= TRIP_END:
        return None
    return (value - TRIP_START).days + 1


def trip_context(now: datetime | None = None) -> dict:
    current = (now or datetime.now(ROME)).astimezone(ROME).date()
    number = trip_day_number(current)
    return {
        "today": current.isoformat(), "tomorrow": (current + timedelta(days=1)).isoformat(),
        "dayNumber": number, "totalDays": 15,
        "elapsedDays": max(0, min(15, (current - TRIP_START).days)),
        "remainingDays": max(0, (TRIP_END - current).days + 1) if current <= TRIP_END else 0,
        "phase": "before" if current < TRIP_START else "after" if current > TRIP_END else "during",
    }


def seed_database(db: Session) -> None:
    existing = db.scalars(select(TripDay)).all()
    # Iteration 1 shipped a deliberately empty placeholder seed. Replace only that
    # exact state; never overwrite an itinerary the traveller has edited.
    if existing:
        activity_count = db.scalar(select(func.count(Activity.id))) or 0
        is_placeholder = len(existing) == 15 and activity_count == 0 and all(not d.title for d in existing)
        if not is_placeholder:
            ensure_editable_itinerary(db); return
        db.execute(delete(Route)); db.execute(delete(ChecklistItem)); db.execute(delete(TripDay)); db.commit()
    path = Path(__file__).parents[1] / "data" / "itinerary.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
    # optional structured stops overlay file (does not replace itinerary.json unless present)
    stops_path = Path(__file__).parents[1] / "data" / "itinerary_stops.json"
    stops_overlay = {}
    if stops_path.exists():
        try:
            overlay = json.loads(stops_path.read_text(encoding="utf-8"))
            stops_overlay = {d["date"]: d.get("stops", []) for d in overlay.get("days", [])}
        except Exception:
            stops_overlay = {}
    for item in payload["days"]:
        day = TripDay(
            date=date.fromisoformat(item["date"]), day_number=item["dayNumber"], title=item["title"],
            base_city=item["baseCity"], destinations=item["destinations"], points_of_interest=item["pointsOfInterest"],
            notes=item["notes"], overnight_location=item["overnightLocation"], coordinates=item["coordinates"], status=item["status"])
        db.add(day)
        db.flush()
        for activity in item["activities"]:
            db.add(Activity(trip_day_id=day.id, **activity))
        for route in item["routes"]:
            db.add(Route(trip_day_id=day.id, **route))
        # create itinerary stops directly from seed if provided
        for stop in stops_overlay.get(item["date"], item.get("stops", [])):
            db.add(ItineraryStop(
                trip_day_id=day.id,
                name=stop.get("name"),
                city=stop.get("city") or day.base_city or day.title,
                item_type=stop.get("item_type", "poi"),
                address=stop.get("address"),
                notes=stop.get("notes"),
                coordinates=stop.get("coordinates"),
                start_time=stop.get("start_time"),
                end_time=stop.get("end_time"),
                status=stop.get("status", "planned"),
                sort_order=stop.get("sort_order") or 0,
                original_key=stop.get("original_key") or f"day-{day.day_number}-stop-{stop.get('sort_order', 0)}"
            ))
    db.commit(); ensure_editable_itinerary(db)
    # optional saved places seed (food recommendations)
    saved_path = Path(__file__).parents[1] / "data" / "saved_places.json"
    if saved_path.exists():
        try:
            saved_payload = json.loads(saved_path.read_text(encoding="utf-8"))
            for entry in saved_payload.get("places", []):
                # avoid duplicate names
                existing = db.scalars(select(SavedPlace).where(SavedPlace.name == entry.get("name"))).all()
                if not existing:
                    db.add(SavedPlace(
                        name=entry.get("name"), category=entry.get("category","food"),
                        latitude=entry.get("coordinates", {}).get("lat"), longitude=entry.get("coordinates", {}).get("lon"),
                        address=entry.get("address"), notes=entry.get("notes"), link=entry.get("link")
                    ))
            db.commit()
        except (OSError, json.JSONDecodeError) as exc:
            print(f"Unable to load saved_places.json: {exc}")


def serialize_day(day: TripDay | None) -> dict | None:
    if not day:
        return None
    return {
        "id": day.id, "date": day.date.isoformat(), "dayNumber": day.day_number, "title": day.title,
        "baseCity": day.base_city, "destinations": day.destinations, "pointsOfInterest": day.points_of_interest,
        "notes": day.notes, "overnightLocation": day.overnight_location, "coordinates": day.coordinates,
        "status": day.status,
        "activityType": day.activities[0].activity_type if day.activities else "free_time",
        "activities": [{"id": a.id, "tripDayId": a.trip_day_id, "title": a.title, "location": a.location,
            "startTime": a.start_time, "endTime": a.end_time, "activityType": a.activity_type,
            "status": a.status, "notes": a.notes, "coordinates": a.coordinates, "address": a.address, "sortOrder": a.sort_order} for a in day.activities],
        "stops": [{"id":s.id,"tripDayId":s.trip_day_id,"name":s.name,"city":s.city,"itemType":s.item_type,
            "address":s.address,"notes":s.notes,"coordinates":s.coordinates,"status":s.status,
            "startTime":s.start_time,"endTime":s.end_time,
            "sortOrder":s.sort_order,"original":bool(s.original_key)} for s in day.stops if not s.archived],
        "routes": [{"id": r.id, "origin": r.origin, "destination": r.destination,
            "originAddress":r.origin_address,"destinationAddress":r.destination_address,"mode":r.mode,
            "originCoordinates": r.origin_coordinates, "destinationCoordinates": r.destination_coordinates,
            "plannedDeparture": r.planned_departure, "plannedDurationMinutes": r.planned_duration_minutes,
            "distanceKm": r.distance_km,"sortOrder":r.sort_order} for r in day.routes if not r.archived],
    }


def cache_get(db: Session, key: str, allow_stale: bool = False) -> tuple[dict | None, bool]:
    entry = db.get(CacheEntry, key)
    if not entry:
        return None, False
    fresh = entry.expires_at.replace(tzinfo=ROME) > datetime.now(ROME) if entry.expires_at.tzinfo is None else entry.expires_at > datetime.now(ROME)
    return (entry.value if fresh or allow_stale else None), fresh


def cache_put(db: Session, key: str, value: dict, ttl_minutes: int) -> None:
    now = datetime.now(ROME)
    entry = db.get(CacheEntry, key) or CacheEntry(key=key, value=value, fetched_at=now, expires_at=now)
    entry.value, entry.fetched_at, entry.expires_at = value, now, now + timedelta(minutes=ttl_minutes)
    db.add(entry); db.commit()


async def request_json(url: str, params: dict, attempts: int = 3) -> dict:
    error = None
    async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "PipAndPipTravelers/1.0 (personal travel dashboard)"}) as client:
        for attempt in range(attempts):
            try:
                response = await client.get(url, params=params)
                response.raise_for_status()
                return response.json()
            except (httpx.HTTPError, ValueError) as exc:
                error = exc
                if attempt + 1 < attempts:
                    await asyncio.sleep(0.25 * (2 ** attempt))
    raise RuntimeError(f"Provider unavailable: {type(error).__name__}")


async def geocode_preview(query: str) -> dict:
    """Preview public-place candidates only; persistence is a separate confirmed action."""
    async with httpx.AsyncClient(timeout=10,headers={"User-Agent":"PipAndPipTravelers/1.0 (public itinerary address verification)"}) as client:
        response=await client.get("https://nominatim.openstreetmap.org/search",params={
            "q":query,"format":"jsonv2","limit":3,"countrycodes":"it","addressdetails":1})
        response.raise_for_status();raw=response.json()
    candidates=[{"displayName":item.get("display_name"),"coordinates":{"lat":float(item["lat"]),"lon":float(item["lon"])},
        "type":item.get("type"),"importance":item.get("importance")} for item in raw]
    unambiguous=len(candidates)==1 or (len(candidates)>1 and (candidates[0].get("importance") or 0)-(candidates[1].get("importance") or 0)>.18)
    return {"query":query,"candidates":candidates,"ambiguous":bool(candidates) and not unambiguous,
        "provider":"Nominatim / OpenStreetMap"}


async def reverse_geocode(db: Session, lat: float, lon: float) -> str | None:
    key=f"reverse-geocode:{lat:.3f}:{lon:.3f}"
    cached,_=cache_get(db,key,allow_stale=True)
    if cached:return cached.get("location")
    try:
        raw=await request_json("https://nominatim.openstreetmap.org/reverse",{
            "lat":lat,"lon":lon,"format":"jsonv2","zoom":12,"addressdetails":1,"accept-language":"it"},attempts=1)
        address=raw.get("address") or {}
        location=next((address.get(name) for name in ("city","town","village","municipality","county") if address.get(name)),None)
        cache_put(db,key,{"location":location,"source":"OpenStreetMap Nominatim"},10080)
        return location
    except RuntimeError:
        return None


async def weather(db: Session, lat: float, lon: float, target_date: date | None = None) -> dict:
    requested = target_date or datetime.now(ROME).date()
    days_ahead = (requested - datetime.now(ROME).date()).days
    if days_ahead > 15:
        return {"provider":"Open-Meteo","dataState":"UNAVAILABLE",
                "message":"Forecast non ancora disponibile per questa data","current":None}
    key = f"weather:{lat:.3f}:{lon:.3f}:{requested.isoformat()}"
    cached, fresh = cache_get(db, key)
    if cached:
        return {**cached, "dataState": "CACHE", "cacheFresh": fresh}
    params = {
        "latitude": lat, "longitude": lon, "timezone": "Europe/Rome", "forecast_days": max(3, days_ahead + 1),
        "current": "temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m",
        "hourly": "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,wind_gusts_10m,uv_index",
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max"
    }
    try:
        raw = await request_json("https://api.open-meteo.com/v1/forecast", params)
        value = {"provider": "Open-Meteo", "updatedAt": datetime.now(ROME).isoformat(), "current": raw.get("current"),
                 "hourly": raw.get("hourly"), "daily": raw.get("daily"), "dataState": "LIVE"}
        if requested != datetime.now(ROME).date():
            daily=raw.get("daily") or {}; dates=daily.get("time") or []
            if requested.isoformat() not in dates:
                return {"provider":"Open-Meteo","dataState":"UNAVAILABLE",
                        "message":"Forecast non ancora disponibile per questa data","current":None}
            index=dates.index(requested.isoformat())
            value["current"]={"temperature_2m":daily.get("temperature_2m_max",[None])[index],
                "apparent_temperature":daily.get("temperature_2m_max",[None])[index],
                "relative_humidity_2m":"—","wind_speed_10m":0}
            value["message"]="Previsione giornaliera per la data simulata"
        cache_put(db, key, value, 15)
        return value
    except RuntimeError as exc:
        stale, _ = cache_get(db, key, allow_stale=True)
        if stale:
            return {**stale, "dataState": "OFFLINE", "message": "Dati in cache; provider non raggiungibile"}
        return {"provider": "Open-Meteo", "dataState": "ERROR", "message": str(exc), "current": None}


async def sea(db: Session, lat: float, lon: float) -> dict:
    key = f"sea:{lat:.3f}:{lon:.3f}"
    cached, fresh = cache_get(db, key)
    if cached: return {**cached, "dataState": "CACHE", "cacheFresh": fresh}
    try:
        raw = await request_json("https://marine-api.open-meteo.com/v1/marine", {
            "latitude": lat, "longitude": lon, "timezone": "Europe/Rome", "forecast_days": 3,
            "hourly": "wave_height,wave_direction,wave_period,sea_surface_temperature"})
        value = {"provider": "Open-Meteo Marine", "updatedAt": datetime.now(ROME).isoformat(), "hourly": raw.get("hourly"), "dataState": "LIVE"}
        cache_put(db, key, value, 20); return value
    except RuntimeError as exc:
        stale, _ = cache_get(db, key, allow_stale=True)
        return {**stale, "dataState": "OFFLINE"} if stale else {"provider":"Open-Meteo Marine","dataState":"ERROR","message":str(exc)}


def leave_now(activity_time: datetime, duration_minutes: int, traffic_delay_minutes: int | None, buffer_minutes: int, now: datetime) -> dict:
    live_duration = duration_minutes + (traffic_delay_minutes or 0)
    depart_at = activity_time - timedelta(minutes=live_duration + buffer_minutes)
    minutes_until = int((depart_at - now).total_seconds() // 60)
    state = "leave_now" if minutes_until <= 0 else "soon" if minutes_until <= 30 else "later"
    return {"departureSuggested": depart_at.isoformat(), "minutesUntilDeparture": minutes_until, "state": state,
            "trafficAvailable": traffic_delay_minutes is not None, "bufferMinutes": buffer_minutes}


def prioritize_alerts(alerts: list[dict], locations: list[str]) -> list[dict]:
    rank = {name.casefold(): index for index, name in enumerate(locations)}
    return sorted(alerts, key=lambda a: (rank.get(str(a.get("location", "")).casefold(), 99),
        {"critical":0,"warning":1,"info":2,"ok":3}.get(str(a.get("level", "info")).lower(), 2)))


def current_trip_context(db: Session, now: datetime | None = None, target_date: date | None = None) -> dict:
    effective_now = now
    if target_date is not None:
        effective_now = datetime.combine(target_date, time(12), tzinfo=ROME)
    temporal = trip_context(effective_now)
    target = date.fromisoformat(temporal["today"])
    day = db.scalar(select(TripDay).where(TripDay.date == target))
    if not day:
        return {**temporal, "primaryLocation":None, "nextLocation":None, "activityType":None,
            "coordinates":None, "nextActivity":None, "nextRoute":None}
    active_stop=next_itinerary_stop(day)
    # prefer a planned sea/boat_trip activity over a stop when such an activity exists (e.g., full-day boat trips)
    planned_sea_activity = next((a for a in day.activities if a.status == "planned" and a.activity_type in {"sea","boat_trip"}), None)
    if planned_sea_activity:
        active = planned_sea_activity
        active_stop = None
    else:
        active = None if active_stop else next((a for a in day.activities if a.status == "planned"), day.activities[0] if day.activities else None)
    route = next((r for r in sorted(day.routes,key=lambda item:item.sort_order) if not r.archived),None)
    primary = active_stop.city if active_stop else active.location if active else day.base_city
    next_location = route.destination if route else (day.destinations[1] if len(day.destinations)>1 else None)
    coords = active_stop.coordinates if active_stop and active_stop.coordinates else active.coordinates if active and active.coordinates else day.coordinates
    return {**temporal, "day":day.day_number, "primaryLocation":primary, "nextLocation":next_location,
        "activityType":active_stop.item_type if active_stop else active.activity_type if active else "free_time", "coordinates":coords,
        "nextActivity":({"id":active_stop.id,"title":active_stop.name,"startTime":active_stop.start_time,"location":active_stop.city,"address":active_stop.address} if active_stop else
            {"id":active.id,"title":active.title,"startTime":active.start_time,"location":active.location,"address":active.address} if active else None),
        "nextRoute":None if not route else {"id":route.id,"origin":route.origin,"destination":route.destination,
            "originCoordinates":route.origin_coordinates,"destinationCoordinates":route.destination_coordinates}}


def weather_alerts(data: dict, location: str | None) -> list[dict]:
    current=data.get("current") or {}; alerts=[]; now=datetime.now(ROME).isoformat()
    wind=float(current.get("wind_speed_10m",0) or 0); gust=float(current.get("wind_gusts_10m",0) or 0)
    precipitation=float(current.get("precipitation",0) or 0)
    if gust >= 60 or wind >= 45:
        alerts.append({"severity":"warning","level":"warning","category":"weather","location":location,
            "title":"Vento forte rilevato","description":f"Vento {wind:.0f} km/h, raffiche {gust:.0f} km/h.",
            "source":"Open-Meteo","timestamp":now,"expiresAt":None})
    if precipitation >= 5:
        alerts.append({"severity":"info","level":"info","category":"weather","location":location,
            "title":"Precipitazioni in corso","description":f"Precipitazioni {precipitation:.1f} mm.",
            "source":"Open-Meteo","timestamp":now,"expiresAt":None})
    return alerts


def get_next_activity(day: TripDay | None, now: datetime) -> Activity | None:
    if not day: return None
    candidates=sorted((a for a in day.activities if a.status not in {"completed","skipped"}),key=lambda a:a.sort_order)
    if not candidates:return None
    current_time=now.astimezone(ROME).time()
    eligible=[]
    for item in candidates:
        if not item.start_time:
            eligible.append(item);continue
        try: parsed=time.fromisoformat(item.start_time)
        except ValueError: eligible.append(item);continue
        if parsed>=current_time: eligible.append(item)
    return eligible[0] if eligible else candidates[0]


def next_itinerary_stop(day: TripDay | None):
    if not day: return None
    def stop_key(stop):
        # stops with a start_time should appear before unspecified-time stops
        if stop.start_time:
            return (0, stop.start_time, stop.sort_order or 0)
        return (1, stop.sort_order or 0)
    ordered = sorted((s for s in day.stops if not s.archived), key=stop_key)
    return next((stop for stop in ordered if stop.status == "planned"), None)


def stop_destination(stop) -> str | None:
    return google_destination(stop.coordinates,stop.address,stop.name,stop.city)


def navigation_origin(day: TripDay | None, activity: Activity | None, latitude: float | None, longitude: float | None) -> dict | None:
    if latitude is not None and longitude is not None:
        return {"type":"GPS","lat":latitude,"lon":longitude}
    if day and day.coordinates:
        return {"type":"PLANNED_LOCATION","lat":day.coordinates["lat"],"lon":day.coordinates["lon"]}
    if day and day.routes and day.routes[0].origin_coordinates:
        value=day.routes[0].origin_coordinates
        return {"type":"ITINERARY_ROUTE_ORIGIN","lat":value["lat"],"lon":value["lon"]}
    return None


def get_next_trip_leg(db: Session, effective_date: date) -> dict | None:
    """Resolve the next leg from the ordered stop/transfer timeline."""
    if effective_date < TRIP_START or effective_date > TRIP_END:return None
    days=db.scalars(select(TripDay).where(TripDay.date>=effective_date).order_by(TripDay.date)).unique().all()
    if not days:return None
    current=days[0]
    current_routes=sorted((r for r in current.routes if not r.archived),key=lambda r:r.sort_order)
    if current.date==effective_date:
        active=next_itinerary_stop(current)
        # If there's no in-day route and an inter-day transfer to the following day's primary activity is expected,
        # treat the next leg as INTER_DAY even when an active stop exists. This preserves inter-day routing semantics.
        if active and not current_routes and len(days)>1:
            following_day=days[1]
            origin_name=current.base_city or (current.destinations[-1] if current.destinations else current.title)
            first_activity=next((a for a in sorted(following_day.activities,key=lambda a:a.sort_order)
                if a.status not in {"completed","skipped"} and a.location and a.coordinates),None)
            destination_name=(first_activity.location if first_activity else None) or (following_day.destinations[0] if following_day.destinations else following_day.base_city or following_day.title)
            destination_coordinates=(first_activity.coordinates if first_activity else None) or following_day.coordinates
            if origin_name and destination_name and origin_name.casefold()!=destination_name.casefold() and current.coordinates and destination_coordinates:
                return {"id":None,"kind":"INTER_DAY","dayId":following_day.id,"origin":origin_name,
                    "destination":destination_name,"originCoordinates":current.coordinates,
                    "destinationCoordinates":destination_coordinates,"plannedDeparture":None}
        if active:
            # if there is an in-day route scheduled before the active stop (e.g., an early transfer into the day's area),
            # prefer that route as the next planned leg
            if current_routes and current_routes[0].sort_order < (active.sort_order or 0):
                route = current_routes[0]
                return {"id":route.id,"kind":"PLANNED","dayId":current.id,"origin":route.origin,
                    "destination":route.destination,"originCoordinates":route.origin_coordinates,
                    "destinationCoordinates":route.destination_coordinates,"originAddress":route.origin_address,
                    "destinationAddress":route.destination_address,"plannedDeparture":route.planned_departure,
                    "googleMapsUrl":google_maps_url(google_destination(route.destination_coordinates,route.destination_address,route.destination) or route.destination)}
            following=sorted(
                [stop for stop in current.stops if not stop.archived and stop.status not in {"completed","skipped"} and stop.sort_order>active.sort_order]
                +[route for route in current_routes if route.sort_order>active.sort_order],
                key=lambda item:item.sort_order,
            )
            if following:
                # prefer the first route in the following sequence if present (routes represent planned transfers)
                first_route = next((it for it in following if isinstance(it, Route)), None)
                if first_route:
                    item = first_route
                    return {"id":item.id,"kind":"PLANNED","dayId":current.id,"origin":item.origin,
                        "destination":item.destination,"originCoordinates":item.origin_coordinates,
                        "destinationCoordinates":item.destination_coordinates,"originAddress":item.origin_address,
                        "destinationAddress":item.destination_address,"plannedDeparture":item.planned_departure,
                        "googleMapsUrl":google_maps_url(google_destination(item.destination_coordinates,item.destination_address,item.destination) or item.destination)}
                item=following[0]
                if isinstance(item,Route):
                    return {"id":item.id,"kind":"PLANNED","dayId":current.id,"origin":item.origin,
                        "destination":item.destination,"originCoordinates":item.origin_coordinates,
                        "destinationCoordinates":item.destination_coordinates,"originAddress":item.origin_address,
                        "destinationAddress":item.destination_address,"plannedDeparture":item.planned_departure,
                        "googleMapsUrl":google_maps_url(google_destination(item.destination_coordinates,item.destination_address,item.destination) or item.destination)}
                return {"id":None,"kind":"POI","dayId":current.id,"origin":active.name,
                    "destination":item.name,"originCoordinates":active.coordinates,
                    "destinationCoordinates":item.coordinates,"originAddress":active.address,
                    "destinationAddress":item.address,"plannedDeparture":None,
                    "googleMapsUrl":google_maps_url(stop_destination(item) or item.name)}
        if current_routes:
            route=current_routes[0]
            return {"id":route.id,"kind":"PLANNED","dayId":current.id,"origin":route.origin,
                "destination":route.destination,"originCoordinates":route.origin_coordinates,
                "destinationCoordinates":route.destination_coordinates,"originAddress":route.origin_address,
                "destinationAddress":route.destination_address,"plannedDeparture":route.planned_departure,
                "googleMapsUrl":google_maps_url(google_destination(route.destination_coordinates,route.destination_address,route.destination) or route.destination)}
    if current.date==effective_date and len(days)>1:
        following=days[1]
        origin_name=current.base_city or (current.destinations[-1] if current.destinations else current.title)
        first_activity=next((a for a in sorted(following.activities,key=lambda a:a.sort_order)
            if a.status not in {"completed","skipped"} and a.location and a.coordinates),None)
        destination_name=(first_activity.location if first_activity else None) or (following.destinations[0] if following.destinations else following.base_city or following.title)
        destination_coordinates=(first_activity.coordinates if first_activity else None) or following.coordinates
        if origin_name and destination_name and origin_name.casefold()!=destination_name.casefold() and current.coordinates and destination_coordinates:
            return {"id":None,"kind":"INTER_DAY","dayId":following.id,"origin":origin_name,
                "destination":destination_name,"originCoordinates":current.coordinates,
                "destinationCoordinates":destination_coordinates,"plannedDeparture":None}
    for day in days[1:] if current.date==effective_date else days:
        routes=sorted((r for r in day.routes if not r.archived),key=lambda r:r.sort_order)
        if routes:
            route=routes[0]
            return {"id":route.id,"kind":"FUTURE_PLANNED","dayId":day.id,"origin":route.origin,
                "destination":route.destination,"originCoordinates":route.origin_coordinates,
                "destinationCoordinates":route.destination_coordinates,"plannedDeparture":route.planned_departure}
    return None


def haversine_km(origin: dict, destination: dict) -> float:
    lat1,lon1,lat2,lon2=map(radians,[origin["lat"],origin["lon"],destination["lat"],destination["lon"]])
    dlat=lat2-lat1;dlon=lon2-lon1
    return 6371*2*asin(sqrt(sin(dlat/2)**2+cos(lat1)*cos(lat2)*sin(dlon/2)**2))


def google_destination(coordinates: dict | None=None, address: str | None=None, name: str | None=None, city: str | None=None) -> str | None:
    if coordinates and coordinates.get("lat") is not None and coordinates.get("lon") is not None:
        return f"{coordinates['lat']},{coordinates['lon']}"
    if address and address.strip():return address.strip()
    fallback=", ".join(value.strip() for value in (name,city,"Italia") if value and value.strip())
    return fallback or None


def google_maps_url(destination: dict | str, origin: dict | None = None) -> str:
    value=f"{destination['lat']},{destination['lon']}" if isinstance(destination,dict) else destination
    params={"api":"1","destination":value,"travelmode":"driving"}
    if origin and origin.get("type") in {"GPS","SIMULATION"}: params["origin"]=f"{origin['lat']},{origin['lon']}"
    return "https://www.google.com/maps/dir/?"+urlencode(params)
