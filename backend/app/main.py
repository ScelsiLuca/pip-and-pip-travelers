from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select
from sqlalchemy.orm import Session
from .config import settings
from .database import Base, SessionLocal, engine, get_db
from .models import Activity, ChecklistItem, SavedPlace, TripDay
from .schemas import ActivityIn, ActivityPatch, NavigationRequest, SavedPlaceIn
from .services import (ROME, current_trip_context, get_next_activity, google_maps_url,
    get_next_trip_leg, leave_now, navigation_origin, prioritize_alerts, sea, seed_database, serialize_day,
    trip_context, weather, weather_alerts)
from .providers import etna_latest, google_route, osrm_route, tomtom_route


@asynccontextmanager
async def lifespan(_: FastAPI):
    Path("data").mkdir(exist_ok=True)
    Base.metadata.create_all(engine)
    with SessionLocal() as db: seed_database(db)
    yield


app = FastAPI(title="Pip & Pip Travelers API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?", allow_methods=["*"], allow_headers=["*"])


@app.get("/health")
def health(): return {"status": "ok"}


@app.get("/api/status")
async def status(db: Session = Depends(get_db)):
    etna = await etna_latest(db)
    return {"status":"ok", "timezone":"Europe/Rome", "providers": {
        "weather":{"name":"Open-Meteo","state":"READY","requiresKey":False},
        "routing":{"name":"OSRM","state":"READY","requiresKey":False},
        "sea":{"name":"Open-Meteo Marine","state":"READY","requiresKey":False},
        "traffic":{"name":"TomTom Routing API","state":"LIVE" if settings.tomtom_api_key else "NOT_CONFIGURED","requiresKey":True},
        "googleRoutes":{"name":"Google Routes API","state":"READY" if settings.google_routes_api_key else "NOT_CONFIGURED","requiresKey":True},
        "news":{"name":settings.news_provider,"state":"NOT_IMPLEMENTED"},
        "etna":{"name":"INGV Osservatorio Etneo","state":etna["dataState"]},
        "database":{"name":"SQLite","state":"OK"}},
        "mockData": settings.allow_mock_data}


@app.get("/api/trip")
def trip(db: Session = Depends(get_db)):
    return {"startDate":"2026-08-21", "endDate":"2026-09-04", "context":trip_context(),
            "unscheduledNotes":["Trapani / Erice","Monreale / Palermo","Cefalù","Trapani - gelati e granite","Erice - gelati e granite"],
            "days":[serialize_day(day) for day in db.scalars(select(TripDay).order_by(TripDay.date)).unique().all()]}


@app.get("/api/trip/context/current")
def context_current(db: Session = Depends(get_db)): return current_trip_context(db)


def day_for(target: date, db: Session):
    return db.scalar(select(TripDay).where(TripDay.date == target))


@app.get("/api/trip/today")
def today(db: Session = Depends(get_db)): return serialize_day(day_for(datetime.now(ROME).date(), db))


@app.get("/api/trip/tomorrow")
def tomorrow(db: Session = Depends(get_db)): return serialize_day(day_for(datetime.now(ROME).date()+timedelta(days=1), db))


@app.get("/api/trip/{day_id}")
def one_day(day_id: int, db: Session = Depends(get_db)):
    day = db.get(TripDay, day_id)
    if not day: raise HTTPException(404, "Giornata non trovata")
    return serialize_day(day)


@app.post("/api/trip/{day_id}/activities", status_code=201)
def add_activity(day_id: int, payload: ActivityIn, db: Session = Depends(get_db)):
    if not db.get(TripDay, day_id): raise HTTPException(404, "Giornata non trovata")
    activity = Activity(trip_day_id=day_id, **payload.model_dump()); db.add(activity); db.commit(); db.refresh(activity)
    return {"id":activity.id}


@app.patch("/api/activities/{activity_id}")
def update_activity(activity_id: int, payload: ActivityPatch, db: Session = Depends(get_db)):
    activity = db.get(Activity, activity_id)
    if not activity: raise HTTPException(404, "Attività non trovata")
    for key, value in payload.model_dump(exclude_unset=True).items(): setattr(activity, key, value)
    db.commit(); return {"status":"ok"}


@app.delete("/api/activities/{activity_id}", status_code=204)
def delete_activity(activity_id: int, db: Session = Depends(get_db)):
    activity = db.get(Activity, activity_id)
    if not activity: raise HTTPException(404, "Attività non trovata")
    db.delete(activity); db.commit()


@app.get("/api/weather/{location}")
async def location_weather(location: str, lat: float = Query(...), lon: float = Query(...), db: Session = Depends(get_db)):
    return await weather(db, lat, lon)


@app.get("/api/sea/{location}")
async def location_sea(location: str, lat: float = Query(...), lon: float = Query(...), db: Session = Depends(get_db)):
    return await sea(db, lat, lon)


@app.get("/api/routes/{day_id}")
async def routes_for_day(day_id: int, db: Session = Depends(get_db)):
    day=db.get(TripDay,day_id)
    if not day: raise HTTPException(404,"Giornata non trovata")
    output=[]
    for item in day.routes:
        base={"id":item.id,"origin":item.origin,"destination":item.destination}
        if not item.origin_coordinates or not item.destination_coordinates:
            output.append({**base,"routing":{"dataState":"UNAVAILABLE","message":"Coordinate tratta non disponibili"}});continue
        routing=await osrm_route(db,item.origin_coordinates,item.destination_coordinates)
        traffic=await tomtom_route(db,item.origin_coordinates,item.destination_coordinates)
        output.append({**base,"originCoordinates":item.origin_coordinates,"destinationCoordinates":item.destination_coordinates,
            "routing":routing,"traffic":traffic})
    return output


@app.get("/api/etna/status")
async def etna_status(db: Session = Depends(get_db)): return await etna_latest(db)


@app.post("/api/navigation/next")
async def navigation_next(payload: NavigationRequest, db: Session = Depends(get_db)):
    now=datetime.now(ROME)
    target_date=payload.simulation_date if payload.simulation and payload.simulation_date else now.date()
    day=day_for(target_date,db); activity=get_next_activity(day,now)
    if not day or not activity:
        return {"origin":None,"originState":"LOCATION_UNAVAILABLE","nextActivity":None,
            "route":{"dataState":"UNAVAILABLE","message":"Nessuna attività successiva per la giornata"},"leaveNow":None}
    origin=navigation_origin(day,activity,payload.latitude,payload.longitude)
    if payload.simulation and origin and payload.latitude is not None:
        origin["type"]="SIMULATION"
    destination=activity.coordinates
    if not destination and day.routes:
        matching=next((r for r in day.routes if r.destination.casefold()==(activity.location or "").casefold()),None)
        if matching: destination=matching.destination_coordinates
    if not destination:
        destination=day.coordinates
    activity_data={"id":activity.id,"title":activity.title,"location":activity.location,
        "startTime":activity.start_time,"activityType":activity.activity_type,"coordinates":destination}
    if not origin or not destination:
        return {"origin":origin,"originState":origin["type"] if origin else "LOCATION_UNAVAILABLE",
            "nextActivity":activity_data,"route":{"dataState":"UNAVAILABLE","message":"Coordinate non disponibili"},
            "googleMapsUrl":google_maps_url(destination) if destination else None,"leaveNow":None}
    base=None
    if settings.routing_provider=="google":
        base=await google_route(db,origin,destination,traffic=settings.traffic_provider=="google")
    if not base or base.get("dataState") in {"ERROR","NOT_CONFIGURED"}:
        base=await osrm_route(db,origin,destination)
    route_data={"provider":base.get("provider"),"dataState":base.get("dataState"),
        "distanceKm":base.get("distanceKm"),"staticDurationMinutes":base.get("staticDurationMinutes",base.get("durationMinutes")),
        "liveDurationMinutes":None,"trafficDelayMinutes":None,"geometry":base.get("geometry"),"updatedAt":base.get("updatedAt")}
    traffic=None
    if settings.traffic_provider=="google": traffic=await google_route(db,origin,destination,traffic=True)
    elif settings.traffic_provider=="tomtom": traffic=await tomtom_route(db,origin,destination)
    if traffic and traffic.get("dataState") not in {"ERROR","NOT_CONFIGURED"}:
        route_data.update({"provider":traffic.get("provider"),"dataState":traffic.get("dataState"),
            "distanceKm":traffic.get("distanceKm",route_data["distanceKm"]),
            "staticDurationMinutes":traffic.get("staticDurationMinutes",traffic.get("baseDurationMinutes",route_data["staticDurationMinutes"])),
            "liveDurationMinutes":traffic.get("liveDurationMinutes"),"trafficDelayMinutes":traffic.get("trafficDelayMinutes"),
            "geometry":traffic.get("geometry") or route_data["geometry"],"updatedAt":traffic.get("updatedAt")})
    elif settings.traffic_provider=="none": route_data["trafficState"]="NOT_CONFIGURED"
    duration=route_data["liveDurationMinutes"] or route_data["staticDurationMinutes"]
    leave=None
    if activity.start_time and duration:
        start=datetime.combine(target_date,time.fromisoformat(activity.start_time),tzinfo=ROME)
        leave=leave_now(start,int(duration),0,settings.leave_now_buffer_minutes,now)
    return {"origin":origin,"originState":origin["type"],"nextActivity":activity_data,"route":route_data,
        "googleMapsUrl":google_maps_url(destination,origin),"leaveNow":leave,
        "privacy":{"persisted":False,"message":"La posizione non viene salvata"}}


@app.get("/api/dashboard/today")
async def dashboard_today(target_date: date | None = Query(None, alias="date"), db: Session = Depends(get_db)):
    context = current_trip_context(db, target_date=target_date); day = day_for(date.fromisoformat(context["today"]), db)
    result = {"context":context, "day":serialize_day(day), "weather":{"dataState":"UNAVAILABLE","message":"Coordinate della giornata non configurate"},
              "traffic":{"dataState":"NOT_CONFIGURED","message":"Configura TOMTOM_API_KEY per il traffico live"},
              "routing":{"dataState":"UNAVAILABLE","message":"Nessuna tratta per oggi"},
              "sea":{"dataState":"UNAVAILABLE","message":"Giornata non marina"},
              "alerts":[], "news":[], "etna":{"dataState":"UNAVAILABLE","message":"Fuori dalla finestra Etna"},
              "nextTripLeg":None,"alertCoverage":{},"alertCoverageState":"PARTIAL"}
    if context.get("coordinates"):
        coords=context["coordinates"]; result["weather"] = await weather(db, coords["lat"], coords["lon"], target_date)
        if context.get("activityType") in {"sea","boat_trip"}: result["sea"] = await sea(db,coords["lat"],coords["lon"])
        result["alerts"]=weather_alerts(result["weather"],context.get("primaryLocation"))
    leg=get_next_trip_leg(db,date.fromisoformat(context["today"]));result["nextTripLeg"]=leg
    if leg and leg.get("originCoordinates") and leg.get("destinationCoordinates"):
        result["routing"]=await osrm_route(db,leg["originCoordinates"],leg["destinationCoordinates"])
        result["traffic"]=await tomtom_route(db,leg["originCoordinates"],leg["destinationCoordinates"])
    etna_day=date(2026,8,23)
    current=date.fromisoformat(context["today"])
    if timedelta(0) <= etna_day-current <= timedelta(hours=48) or current==etna_day:
        result["etna"]=await etna_latest(db)
    locations=[x for x in [context.get("primaryLocation"),context.get("nextLocation")] if x]
    result["alerts"]=prioritize_alerts(result["alerts"],locations)
    relevant_etna=context.get("activityType")=="etna" or timedelta(0)<=etna_day-current<=timedelta(hours=72)
    result["alertCoverage"]={"weather":result["weather"].get("dataState","UNAVAILABLE"),
        "etna":result["etna"].get("dataState","UNAVAILABLE") if relevant_etna else "UNAVAILABLE",
        "traffic":result["traffic"].get("dataState","NOT_CONFIGURED"),"news":"NOT_CONFIGURED",
        "civilProtection":"NOT_CONFIGURED","marine":result["sea"].get("dataState","UNAVAILABLE")}
    active=[v for k,v in result["alertCoverage"].items() if k in {"weather","etna","traffic","marine"}]
    result["alertCoverageState"]="FULL" if active and all(v in {"LIVE","CACHE"} for v in active) else "PARTIAL"
    return result


@app.get("/api/saved")
def saved(db: Session = Depends(get_db)): return db.scalars(select(SavedPlace).order_by(SavedPlace.name)).all()


@app.post("/api/saved", status_code=201)
def save_place(payload: SavedPlaceIn, db: Session = Depends(get_db)):
    place = SavedPlace(**payload.model_dump()); db.add(place); db.commit(); db.refresh(place); return {"id":place.id}


frontend = Path(__file__).parents[2] / "frontend" / "dist"
if frontend.exists():
    app.mount("/assets", StaticFiles(directory=frontend / "assets"), name="assets")
    @app.get("/sw.js", include_in_schema=False)
    def service_worker(): return FileResponse(frontend / "sw.js", media_type="application/javascript")
    @app.get("/manifest.webmanifest", include_in_schema=False)
    def web_manifest(): return FileResponse(frontend / "manifest.webmanifest", media_type="application/manifest+json")
    @app.get("/icon.svg", include_in_schema=False)
    def app_icon(): return FileResponse(frontend / "icon.svg", media_type="image/svg+xml")
    @app.get("/apple-touch-icon.png", include_in_schema=False)
    def apple_touch_icon(): return FileResponse(frontend / "apple-touch-icon.png", media_type="image/png")
    @app.get("/pwa-icon-192.png", include_in_schema=False)
    def pwa_icon_192(): return FileResponse(frontend / "pwa-icon-192.png", media_type="image/png")
    @app.get("/pwa-icon-512.png", include_in_schema=False)
    def pwa_icon_512(): return FileResponse(frontend / "pwa-icon-512.png", media_type="image/png")
    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str): return FileResponse(frontend / "index.html")
