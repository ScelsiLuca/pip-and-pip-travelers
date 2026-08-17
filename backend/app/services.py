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
from .models import Activity, CacheEntry, ChecklistItem, Route, TripDay

ROME = ZoneInfo("Europe/Rome")
TRIP_START = date(2026, 8, 21)
TRIP_END = date(2026, 9, 4)


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
            return
        db.execute(delete(Route)); db.execute(delete(ChecklistItem)); db.execute(delete(TripDay)); db.commit()
    path = Path(__file__).parents[1] / "data" / "itinerary.json"
    payload = json.loads(path.read_text(encoding="utf-8"))
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
    db.commit()


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
            "status": a.status, "notes": a.notes, "coordinates": a.coordinates, "sortOrder": a.sort_order} for a in day.activities],
        "routes": [{"id": r.id, "origin": r.origin, "destination": r.destination,
            "originCoordinates": r.origin_coordinates, "destinationCoordinates": r.destination_coordinates,
            "plannedDeparture": r.planned_departure, "plannedDurationMinutes": r.planned_duration_minutes,
            "distanceKm": r.distance_km} for r in day.routes],
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
    async with httpx.AsyncClient(timeout=8, headers={"User-Agent": "SicilyLiveDashboard/1.0"}) as client:
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
    active = next((a for a in day.activities if a.status == "planned"), day.activities[0] if day.activities else None)
    route = day.routes[0] if day.routes else None
    primary = active.location if active else day.base_city
    next_location = route.destination if route else (day.destinations[1] if len(day.destinations)>1 else None)
    coords = active.coordinates if active and active.coordinates else day.coordinates
    return {**temporal, "day":day.day_number, "primaryLocation":primary, "nextLocation":next_location,
        "activityType":active.activity_type if active else "free_time", "coordinates":coords,
        "nextActivity":None if not active else {"id":active.id,"title":active.title,"startTime":active.start_time,"location":active.location},
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
    """Resolve the next meaningful transfer without promoting POIs to trip legs."""
    if effective_date < TRIP_START or effective_date > TRIP_END:return None
    days=db.scalars(select(TripDay).where(TripDay.date>=effective_date).order_by(TripDay.date)).unique().all()
    if not days:return None
    current=days[0]
    if current.date==effective_date and current.routes:
        route=current.routes[0]
        return {"id":route.id,"kind":"PLANNED","dayId":current.id,"origin":route.origin,
            "destination":route.destination,"originCoordinates":route.origin_coordinates,
            "destinationCoordinates":route.destination_coordinates,"plannedDeparture":route.planned_departure}
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
        if day.routes:
            route=day.routes[0]
            return {"id":route.id,"kind":"FUTURE_PLANNED","dayId":day.id,"origin":route.origin,
                "destination":route.destination,"originCoordinates":route.origin_coordinates,
                "destinationCoordinates":route.destination_coordinates,"plannedDeparture":route.planned_departure}
    return None


def haversine_km(origin: dict, destination: dict) -> float:
    lat1,lon1,lat2,lon2=map(radians,[origin["lat"],origin["lon"],destination["lat"],destination["lon"]])
    dlat=lat2-lat1;dlon=lon2-lon1
    return 6371*2*asin(sqrt(sin(dlat/2)**2+cos(lat1)*cos(lat2)*sin(dlon/2)**2))


def google_maps_url(destination: dict, origin: dict | None = None) -> str:
    params={"api":"1","destination":f"{destination['lat']},{destination['lon']}","travelmode":"driving"}
    if origin and origin.get("type") in {"GPS","SIMULATION"}: params["origin"]=f"{origin['lat']},{origin['lon']}"
    return "https://www.google.com/maps/dir/?"+urlencode(params)
