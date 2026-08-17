from __future__ import annotations

import html
import re
from datetime import datetime
from urllib.parse import quote
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from .config import settings
from .services import cache_get, cache_put, request_json

ROME = ZoneInfo("Europe/Rome")
USER_AGENT = "SicilyLiveDashboard/2.0 (local personal travel dashboard)"


async def geocode(db: Session, query: str) -> dict | None:
    key = f"geocode:{query.casefold().strip()}"
    cached, _ = cache_get(db, key, allow_stale=True)
    if cached is not None:
        return cached.get("result")
    raw = await request_json("https://nominatim.openstreetmap.org/search", {
        "q": query, "format": "jsonv2", "limit": 3, "countrycodes": "it", "addressdetails": 1})
    sicily = [x for x in raw if "sicilia" in x.get("display_name", "").casefold()]
    chosen = (sicily or raw or [None])[0]
    result = None if not chosen else {"lat": float(chosen["lat"]), "lon": float(chosen["lon"]),
        "displayName": chosen.get("display_name"), "osmType": chosen.get("osm_type"), "osmId": chosen.get("osm_id")}
    cache_put(db, key, {"result": result, "source": "OpenStreetMap Nominatim"}, 525600)
    return result


async def osrm_route(db: Session, origin: dict, destination: dict) -> dict:
    key = f"route:osrm:{origin['lat']:.5f},{origin['lon']:.5f}:{destination['lat']:.5f},{destination['lon']:.5f}"
    cached, fresh = cache_get(db, key)
    if cached:
        return {**cached, "dataState": "CACHE", "cacheFresh": fresh}
    url = ("https://router.project-osrm.org/route/v1/driving/"
           f"{origin['lon']},{origin['lat']};{destination['lon']},{destination['lat']}")
    try:
        raw = await request_json(url, {"overview":"full", "geometries":"geojson", "steps":"false"})
        item = raw["routes"][0]
        value = {"provider":"OSRM", "sourceUrl":"https://project-osrm.org/", "updatedAt":datetime.now(ROME).isoformat(),
            "distanceKm":round(item["distance"]/1000,1), "durationMinutes":round(item["duration"]/60),
            "geometry":item["geometry"], "dataState":"LIVE"}
        cache_put(db, key, value, 1440)
        return value
    except (RuntimeError, KeyError, IndexError) as exc:
        stale, _ = cache_get(db, key, allow_stale=True)
        return {**stale,"dataState":"OFFLINE"} if stale else {"provider":"OSRM","dataState":"ERROR","message":str(exc)}


async def tomtom_route(db: Session, origin: dict, destination: dict) -> dict:
    if not settings.tomtom_api_key:
        return {"provider":"TomTom Routing API","dataState":"NOT_CONFIGURED",
            "message":"TOMTOM_API_KEY non configurata"}
    key = f"route:tomtom:{origin['lat']:.5f},{origin['lon']:.5f}:{destination['lat']:.5f},{destination['lon']:.5f}"
    cached, fresh = cache_get(db, key)
    if cached: return {**cached,"dataState":"CACHE","cacheFresh":fresh}
    url = ("https://api.tomtom.com/routing/1/calculateRoute/"
           f"{origin['lat']},{origin['lon']}:{destination['lat']},{destination['lon']}/json")
    try:
        raw = await request_json(url,{"key":settings.tomtom_api_key,"traffic":"true","routeType":"fastest","travelMode":"car"})
        summary = raw["routes"][0]["summary"]
        live = round(summary["travelTimeInSeconds"]/60)
        no_traffic = round(summary.get("noTrafficTravelTimeInSeconds",summary["travelTimeInSeconds"])/60)
        value={"provider":"TomTom Routing API","sourceUrl":"https://developer.tomtom.com/routing-api/documentation/routing/calculate-route",
            "updatedAt":datetime.now(ROME).isoformat(),"liveDurationMinutes":live,"baseDurationMinutes":no_traffic,
            "trafficDelayMinutes":max(0,live-no_traffic),"distanceKm":round(summary["lengthInMeters"]/1000,1),"dataState":"LIVE"}
        cache_put(db,key,value,5); return value
    except (RuntimeError,KeyError,IndexError) as exc:
        stale,_=cache_get(db,key,allow_stale=True)
        return {**stale,"dataState":"OFFLINE"} if stale else {"provider":"TomTom Routing API","dataState":"ERROR","message":str(exc)}


def duration_seconds(value: str | None) -> float | None:
    if not value or not value.endswith("s"): return None
    try: return float(value[:-1])
    except ValueError: return None


def traffic_delay_minutes(live_seconds: float | None, static_seconds: float | None) -> int | None:
    if live_seconds is None or static_seconds is None:return None
    return round(max(0,live_seconds-static_seconds)/60)


def decode_google_polyline(value: str) -> list[list[float]]:
    points=[]; index=lat=lon=0
    while index < len(value):
        shifts=[]
        for _ in range(2):
            result=shift=0
            while True:
                byte=ord(value[index])-63; index+=1
                result|=(byte&0x1f)<<shift; shift+=5
                if byte<0x20: break
            shifts.append(~(result>>1) if result&1 else result>>1)
        lat+=shifts[0];lon+=shifts[1];points.append([lon/1e5,lat/1e5])
    return points


async def google_route(db: Session, origin: dict, destination: dict, traffic: bool = True) -> dict:
    if not settings.google_routes_api_key:
        return {"provider":"Google Routes API","dataState":"NOT_CONFIGURED","message":"GOOGLE_ROUTES_API_KEY non configurata"}
    preference="TRAFFIC_AWARE" if traffic else "TRAFFIC_UNAWARE"
    key=f"route:google:{preference}:{origin['lat']:.5f},{origin['lon']:.5f}:{destination['lat']:.5f},{destination['lon']:.5f}"
    cached,fresh=cache_get(db,key)
    if cached:return {**cached,"dataState":"CACHE","cacheFresh":fresh}
    payload={"origin":{"location":{"latLng":{"latitude":origin["lat"],"longitude":origin["lon"]}}},
        "destination":{"location":{"latLng":{"latitude":destination["lat"],"longitude":destination["lon"]}}},
        "travelMode":"DRIVE","routingPreference":preference,"computeAlternativeRoutes":False,
        "languageCode":"it-IT","units":"METRIC"}
    headers={"Content-Type":"application/json","X-Goog-Api-Key":settings.google_routes_api_key,
        "X-Goog-FieldMask":"routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline"}
    try:
        async with httpx.AsyncClient(timeout=10,headers=headers) as client:
            response=await client.post("https://routes.googleapis.com/directions/v2:computeRoutes",json=payload)
            response.raise_for_status(); raw=response.json()
        item=raw["routes"][0];live_seconds=duration_seconds(item.get("duration"));static_seconds=duration_seconds(item.get("staticDuration"))
        encoded=(item.get("polyline") or {}).get("encodedPolyline")
        value={"provider":"Google Routes API","sourceUrl":"https://developers.google.com/maps/documentation/routes",
            "updatedAt":datetime.now(ROME).isoformat(),"distanceKm":round(item["distanceMeters"]/1000,1),
            "staticDurationMinutes":round(static_seconds/60) if static_seconds is not None else None,
            "liveDurationMinutes":round(live_seconds/60) if live_seconds is not None and traffic else None,
            "trafficDelayMinutes":traffic_delay_minutes(live_seconds,static_seconds) if traffic else None,
            "durationMinutes":round((live_seconds or static_seconds)/60) if (live_seconds is not None or static_seconds is not None) else None,
            "geometry":{"type":"LineString","coordinates":decode_google_polyline(encoded)} if encoded else None,"dataState":"LIVE"}
        cache_put(db,key,value,5 if traffic else 1440);return value
    except (httpx.HTTPError,ValueError,KeyError,IndexError) as exc:
        stale,_=cache_get(db,key,allow_stale=True)
        return {**stale,"dataState":"OFFLINE"} if stale else {"provider":"Google Routes API","dataState":"ERROR","message":type(exc).__name__}


def parse_ingv_latest(page: str) -> dict | None:
    text = html.unescape(re.sub(r"<[^>]+>", " ", page))
    text = re.sub(r"\s+", " ", text)
    match = re.search(r"(COMUNICATO DI ATTIVITA.? VULCANICA\s*-?\s*ETNA.*?)(?=ARCHIVIO AGGIORNAMENTI|VULCANICI)", text, re.I)
    if not match:
        return None
    body = match.group(1).strip()
    timestamp = re.search(r"del\s+(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2})\s*\(UTC\)", body, re.I)
    return {"title": body[:180].strip(), "summary": body[:900].strip(),
        "timestamp": timestamp.group(1) + " UTC" if timestamp else None}


async def etna_latest(db: Session) -> dict:
    key="etna:ingv:latest"; cached,fresh=cache_get(db,key)
    if cached:return {**cached,"dataState":"CACHE","cacheFresh":fresh}
    url="https://www.ct.ingv.it/sezioniesterne/UltimiAggiornamenti.php"
    try:
        async with httpx.AsyncClient(timeout=10,headers={"User-Agent":USER_AGENT}) as client:
            response=await client.get(url); response.raise_for_status()
        parsed=parse_ingv_latest(response.text)
        if not parsed: raise ValueError("Formato INGV non riconosciuto")
        value={**parsed,"provider":"INGV Osservatorio Etneo","sourceUrl":url,"updatedAt":datetime.now(ROME).isoformat(),"dataState":"LIVE"}
        cache_put(db,key,value,10);return value
    except (httpx.HTTPError,ValueError) as exc:
        stale,_=cache_get(db,key,allow_stale=True)
        return {**stale,"dataState":"OFFLINE"} if stale else {"provider":"INGV Osservatorio Etneo","sourceUrl":url,"dataState":"ERROR","message":str(exc)}
