import httpx
from contextlib import asynccontextmanager
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo
from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session
from .config import settings
from .database import Base, SessionLocal, engine, get_db, migrate_schema
from .models import Activity, ChecklistItem, ItineraryStop, Route, SavedPlace, TripDay
from .schemas import (ActivityIn, ActivityPatch, NavigationRequest, ReorderRequest, RouteIn,
    RoutePatch, SavedPlaceIn, StopIn, StopPatch, PlaceAutocompleteIn)
from .services import (ROME, current_trip_context, get_next_activity, get_next_trip_leg, google_destination, google_maps_url,
    geocode_preview, leave_now, navigation_origin, prioritize_alerts, sea, seed_database, serialize_day,
    stop_destination, next_itinerary_stop, reverse_geocode, trip_context, weather, weather_alerts)
from .restaurants import (
    google_place_autocomplete,
    google_place_details,
    recommended_restaurants,
)
from .providers import etna_latest, google_route, osrm_route, tomtom_route


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.sqlite_path:
        Path(settings.sqlite_path).expanduser().parent.mkdir(parents=True, exist_ok=True)
    else:
        Path("data").mkdir(exist_ok=True)
    Base.metadata.create_all(engine)
    migrate_schema()
    with SessionLocal() as db: seed_database(db)
    yield


app = FastAPI(title="Pip & Pip Travelers API", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.origins, allow_methods=["*"], allow_headers=["*"])


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
        "googlePlaces":{"name":"Google Places API (New)","state":"READY" if settings.google_places_api_key else "NOT_CONFIGURED","requiresKey":True},
        "tripadvisor":{"name":"Tripadvisor Content API","state":"READY" if settings.tripadvisor_api_key else "NOT_CONFIGURED","requiresKey":True},
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


@app.post("/api/trip/{day_id}/stops", status_code=201)
def add_stop(day_id: int, payload: StopIn, db: Session = Depends(get_db)):
    day=db.get(TripDay,day_id)
    if not day:raise HTTPException(404,"Giornata non trovata")
    highest=max([item.sort_order for item in day.stops if not item.archived]+[item.sort_order for item in day.routes if not item.archived]+[0])
    stop=ItineraryStop(trip_day_id=day_id,**payload.model_dump(exclude={"sort_order"}),sort_order=payload.sort_order or highest+100)
    db.add(stop);db.commit();db.refresh(stop);return {"id":stop.id}


@app.patch("/api/stops/{stop_id}")
def update_stop(stop_id: int, payload: StopPatch, db: Session = Depends(get_db)):
    stop=db.get(ItineraryStop,stop_id)
    if not stop:raise HTTPException(404,"Tappa non trovata")
    for key,value in payload.model_dump(exclude_unset=True).items():setattr(stop,key,value)
    db.commit();return {"status":"ok"}


@app.delete("/api/stops/{stop_id}")
def delete_stop(stop_id: int, db: Session = Depends(get_db)):
    stop=db.get(ItineraryStop,stop_id)
    if not stop:raise HTTPException(404,"Tappa non trovata")
    stop.archived=True;db.commit();return {"status":"archived"}


@app.post("/api/stops/{stop_id}/restore")
def restore_stop(stop_id: int, db: Session = Depends(get_db)):
    stop=db.get(ItineraryStop,stop_id)
    if not stop:raise HTTPException(404,"Tappa non trovata")
    stop.archived=False;db.commit();return {"status":"ok"}


@app.post("/api/trip/{day_id}/routes",status_code=201)
def add_route(day_id:int,payload:RouteIn,db:Session=Depends(get_db)):
    day=db.get(TripDay,day_id)
    if not day:raise HTTPException(404,"Giornata non trovata")
    highest=max([item.sort_order for item in day.stops if not item.archived]+[item.sort_order for item in day.routes if not item.archived]+[0])
    route=Route(trip_day_id=day_id,**payload.model_dump(exclude={"sort_order"}),sort_order=payload.sort_order or highest+100)
    db.add(route);db.commit();db.refresh(route);return {"id":route.id}


@app.patch("/api/routes/item/{route_id}")
def update_route(route_id:int,payload:RoutePatch,db:Session=Depends(get_db)):
    route=db.get(Route,route_id)
    if not route:raise HTTPException(404,"Trasferimento non trovato")
    for key,value in payload.model_dump(exclude_unset=True).items():setattr(route,key,value)
    db.commit();return {"status":"ok"}


@app.delete("/api/routes/item/{route_id}")
def delete_route(route_id:int,db:Session=Depends(get_db)):
    route=db.get(Route,route_id)
    if not route:raise HTTPException(404,"Trasferimento non trovato")
    route.archived=True;db.commit();return {"status":"archived"}


@app.post("/api/routes/item/{route_id}/restore")
def restore_route(route_id:int,db:Session=Depends(get_db)):
    route=db.get(Route,route_id)
    if not route:raise HTTPException(404,"Trasferimento non trovato")
    route.archived=False;db.commit();return {"status":"ok"}


@app.post("/api/trip/{day_id}/reorder")
def reorder_timeline(day_id:int,payload:ReorderRequest,db:Session=Depends(get_db)):
    day=db.get(TripDay,day_id)
    if not day:raise HTTPException(404,"Giornata non trovata")
    valid={("stop",item.id):item for item in day.stops if not item.archived}|{("route",item.id):item for item in day.routes if not item.archived}
    received=[(item.kind,item.id) for item in payload.items]
    if len(received)!=len(set(received)) or set(received)!=set(valid):raise HTTPException(422,"La sequenza deve includere una sola volta tutti gli elementi attivi")
    for index,key in enumerate(received,1):valid[key].sort_order=index*100
    db.commit();return {"status":"ok","items":len(received)}


@app.post("/api/trip/reset-original")
def reset_original(db:Session=Depends(get_db)):
    db.execute(delete(ItineraryStop));db.execute(delete(Route));db.execute(delete(Activity));db.execute(delete(ChecklistItem));db.execute(delete(TripDay));db.commit()
    seed_database(db);return {"status":"ok"}


@app.get("/api/geocode/preview")
async def preview_geocode(q:str=Query(...,min_length=3,max_length=300)):
    try:return await geocode_preview(q)
    except Exception:raise HTTPException(503,"Servizio di verifica posizione non disponibile")


@app.get("/api/restaurants/recommended")
async def restaurants(location:str=Query(...,min_length=2,max_length=120),lat:float|None=None,lon:float|None=None,
    open_now:bool=True,limit:int=Query(8,ge=1,le=8),refresh:bool=False,db:Session=Depends(get_db)):
    result=await recommended_restaurants(db,location,lat,lon,refresh)
    if open_now:result["restaurants"]=[item for item in result["restaurants"] if item.get("openNow") is True]
    result["restaurants"]=result["restaurants"][:limit];return result


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
    day=day_for(target_date,db)
    stop=next_itinerary_stop(day)
    activity=None if stop else get_next_activity(day,now)
    if not day or (not stop and not activity):
        return {"origin":None,"originState":"LOCATION_UNAVAILABLE","nextActivity":None,
            "route":{"dataState":"UNAVAILABLE","message":"Nessuna attività successiva per la giornata"},"leaveNow":None}
    origin=navigation_origin(day,activity,payload.latitude,payload.longitude)
    if payload.simulation and origin and payload.latitude is not None:
        origin["type"]="SIMULATION"
    destination=stop.coordinates if stop else activity.coordinates
    destination_value=stop_destination(stop) if stop else google_destination(activity.coordinates,activity.address,activity.title,activity.location)
    activity_data={"id":stop.id,"title":stop.name,"location":stop.city,"startTime":None,
        "activityType":stop.item_type,"coordinates":destination,"address":stop.address} if stop else {
        "id":activity.id,"title":activity.title,"location":activity.location,"startTime":activity.start_time,
        "activityType":activity.activity_type,"coordinates":destination,"address":activity.address}
    if not origin or not destination:
        return {"origin":origin,"originState":origin["type"] if origin else "LOCATION_UNAVAILABLE",
            "nextActivity":activity_data,"route":{"dataState":"UNAVAILABLE","message":"Coordinate non disponibili"},
            "googleMapsUrl":google_maps_url(destination_value,origin) if destination_value else None,"leaveNow":None}
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
    if activity and activity.start_time and duration:
        start=datetime.combine(target_date,time.fromisoformat(activity.start_time),tzinfo=ROME)
        leave=leave_now(start,int(duration),0,settings.leave_now_buffer_minutes,now)
    return {"origin":origin,"originState":origin["type"],"nextActivity":activity_data,"route":route_data,
        "googleMapsUrl":google_maps_url(destination_value or destination,origin),"leaveNow":leave,
        "privacy":{"persisted":False,"message":"La posizione non viene salvata"}}


@app.get("/api/dashboard/today")
async def dashboard_today(target_date: date | None = Query(None, alias="date"), latitude: float | None = Query(None, ge=-90, le=90),
    longitude: float | None = Query(None, ge=-180, le=180), live_source: str = Query("GPS", pattern="^(GPS|SIMULATION)$"),
    db: Session = Depends(get_db)):
    context = current_trip_context(db, target_date=target_date); day = day_for(date.fromisoformat(context["today"]), db)
    live_context = current_trip_context(db)
    result = {"context":context, "day":serialize_day(day), "weather":{"dataState":"UNAVAILABLE","message":"Coordinate della giornata non configurate"},
              "traffic":{"dataState":"NOT_CONFIGURED","message":"Configura TOMTOM_API_KEY per il traffico live"},
              "routing":{"dataState":"UNAVAILABLE","message":"Nessuna tratta per oggi"},
              "sea":{"dataState":"UNAVAILABLE","message":"Giornata non marina"},
              "alerts":[], "news":[], "weatherLocation":None,"newsLocation":None,
              "liveCoordinates":None,
              "liveLocationSource":live_source if latitude is not None and longitude is not None else "ITINERARY_FALLBACK",
              "etna":{"dataState":"UNAVAILABLE","message":"Fuori dalla finestra Etna"},
              "nextTripLeg":None,"alertCoverage":{},"alertCoverageState":"PARTIAL"}
    gps_coords={"lat":latitude,"lon":longitude} if latitude is not None and longitude is not None else None
    coords=gps_coords or live_context.get("coordinates")
    live_location=(await reverse_geocode(db,latitude,longitude) or "Posizione GPS") if gps_coords else "Posizione non disponibile"
    result["weatherLocation"]=live_location;result["newsLocation"]=live_location
    result["liveCoordinates"]=gps_coords
    if coords:
        result["weather"] = await weather(db, coords["lat"], coords["lon"])
        result["weather"]["location"]=live_location;result["weather"]["locationSource"]=result["liveLocationSource"]
        if context.get("activityType") in {"sea","boat_trip"}: result["sea"] = await sea(db,coords["lat"],coords["lon"])
        result["alerts"]=weather_alerts(result["weather"],live_location)
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
    active={"weather":result["alertCoverage"]["weather"]}
    if relevant_etna:
        active["etna"]=result["alertCoverage"]["etna"]
    if context.get("activityType") in {"sea","boat_trip"}:
        active["marine"]=result["alertCoverage"]["marine"]
    if result["traffic"].get("dataState")!="NOT_CONFIGURED":
        active["traffic"]=result["alertCoverage"]["traffic"]
    result["alertCoverageState"]="FULL" if active and all(v in {"LIVE","CACHE"} for v in active.values()) else "PARTIAL"
    
    return result
@app.post("/api/places/autocomplete")
async def place_autocomplete(payload: PlaceAutocompleteIn):
    try:
        return await google_place_autocomplete(
            payload.input,
            payload.latitude,
            payload.longitude,
        )
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Google Places autocomplete unavailable",
        )


@app.get("/api/places/{place_id}")
async def place_details(place_id: str):
    try:
        place = await google_place_details(place_id)
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail="Google Place details unavailable",
        )

    if not place:
        raise HTTPException(
            status_code=404,
            detail="Place not found",
        )

    return place

@app.get("/api/saved")
def saved(db: Session = Depends(get_db)): return db.scalars(select(SavedPlace).order_by(SavedPlace.name)).all()


@app.post("/api/saved", status_code=201)
def save_place(payload: SavedPlaceIn, db: Session = Depends(get_db)):
    place = SavedPlace(**payload.model_dump()); db.add(place); db.commit(); db.refresh(place); return {"id":place.id}

@app.put("/api/saved/{place_id}")
def update_saved_place(
    place_id: int,
    payload: SavedPlaceIn,
    db: Session = Depends(get_db),
):
    place = db.get(SavedPlace, place_id)

    if not place:
        raise HTTPException(
            status_code=404,
            detail="Saved place not found",
        )

    for field, value in payload.model_dump().items():
        setattr(place, field, value)

    db.commit()
    db.refresh(place)

    return place


@app.delete("/api/saved/{place_id}", status_code=204)
def delete_saved_place(
    place_id: int,
    db: Session = Depends(get_db),
):
    place = db.get(SavedPlace, place_id)

    if not place:
        raise HTTPException(
            status_code=404,
            detail="Saved place not found",
        )

    db.delete(place)
    db.commit()



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
