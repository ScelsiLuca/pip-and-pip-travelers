import asyncio
import logging
import math
import re
import unicodedata
from datetime import datetime
from urllib.parse import urlencode
import httpx
from numpy import place
from sqlalchemy.orm import Session
from .config import settings
from .services import ROME, cache_get, cache_put

GOOGLE_URL="https://places.googleapis.com/v1/places:searchText"
GOOGLE_AUTOCOMPLETE_URL="https://places.googleapis.com/v1/places:autocomplete"
GOOGLE_PLACE_DETAILS_URL="https://places.googleapis.com/v1/places/{place_id}"
TRIPADVISOR_SEARCH="https://api.content.tripadvisor.com/api/v1/location/search"
TRIPADVISOR_DETAILS="https://api.content.tripadvisor.com/api/v1/location/{location_id}/details"
RESTAURANT_TTL_MINUTES=10
logger=logging.getLogger(__name__)


def normalized_name(value: str) -> str:
    plain=unicodedata.normalize("NFD",value.casefold())
    return " ".join(re.sub(r"[^a-z0-9 ]+"," ",plain.encode("ascii","ignore").decode()).split())


def bayesian_score(rating: float | None, reviews: int | None, prior: float=4.2, weight: int=100) -> float:
    if rating is None:return 0.0
    count=max(0,reviews or 0)
    return (count/(count+weight))*rating+(weight/(count+weight))*prior


def entity_match(google: dict, tripadvisor: dict) -> float:
    left,right=normalized_name(google.get("name", "")),normalized_name(tripadvisor.get("name", ""))
    if not left or not right:return 0.0
    a,b=set(left.split()),set(right.split()); name_score=len(a&b)/max(len(a|b),1)
    city=(google.get("city") or "").casefold(); address=(tripadvisor.get("address") or "").casefold()
    city_score=1.0 if city and city in address else 0.0
    geo_score=0.0
    if google.get("coordinates") and tripadvisor.get("coordinates"):
        lat1,lon1=google["coordinates"]["lat"],google["coordinates"]["lon"]
        lat2,lon2=tripadvisor["coordinates"]["lat"],tripadvisor["coordinates"]["lon"]
        distance=math.hypot((lat1-lat2)*111,(lon1-lon2)*85)
        geo_score=1.0 if distance<0.15 else 0.6 if distance<0.5 else 0.0
    return round(name_score*.55+city_score*.15+geo_score*.30,3)


def cross_source_score(item: dict) -> float:
    google=bayesian_score(item.get("googleRating"),item.get("googleReviewCount"))
    if item.get("tripadvisorRating") is None:return round(google,4)
    trip=bayesian_score(item.get("tripadvisorRating"),item.get("tripadvisorReviewCount"))
    confidence=item.get("matchConfidence") or 0
    return round(google*.60+trip*.40*confidence+google*.40*(1-confidence),4)


def normalize_google(place: dict, city: str) -> dict:
    opening=place.get("currentOpeningHours") or {}
    location=place.get("location") or {}
    return {"placeId":place.get("id"),"name":(place.get("displayName") or {}).get("text"),
        "address":place.get("formattedAddress"),"city":city,
        "coordinates":{"lat":location.get("latitude"),"lon":location.get("longitude")},
        "googleRating":place.get("rating"),"googleReviewCount":place.get("userRatingCount"),
        "openNow":opening.get("openNow"),"priceLevel":place.get("priceLevel"),
        "types":place.get("types") or [],"googleMapsUrl":place.get("googleMapsUri"),
        "attributions":place.get("attributions") or [],"tripadvisorRating":None,
        "tripadvisorReviewCount":None,"tripadvisorUrl":None,"matchConfidence":None}


def is_typical_candidate(item: dict) -> bool:
    text=f"{item.get('name','')} {' '.join(item.get('types') or [])}".casefold()
    blocked=("fast_food","sushi","hamburger","mcdonald","burger king","kfc")
    return item.get("openNow") is True and (item.get("googleReviewCount") or 0)>=40 and not any(x in text for x in blocked)


async def google_places(city: str, lat: float | None=None, lon: float | None=None) -> list[dict]:
    if not settings.google_places_api_key:return []
    body={"textQuery":f"ristoranti tipici siciliani cucina locale a {city}, Sicilia",
        "openNow":True,"minRating":4.0,"pageSize":15,"languageCode":"it","regionCode":"IT"}
    if lat is not None and lon is not None:
        body["locationBias"]={"circle":{"center":{"latitude":lat,"longitude":lon},"radius":7000}}
    mask="places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours,places.priceLevel,places.types,places.googleMapsUri,places.attributions"
    async with httpx.AsyncClient(timeout=10) as client:
        response=await client.post(GOOGLE_URL,json=body,headers={"X-Goog-Api-Key":settings.google_places_api_key,"X-Goog-FieldMask":mask})
        response.raise_for_status()
        return [normalize_google(place,city) for place in response.json().get("places",[])]

async def google_place_autocomplete(
    text: str,
    lat: float | None = None,
    lon: float | None = None,
) -> list[dict]:
    if not settings.google_places_api_key:
        return []

    body = {
        "input": text,
        "languageCode": "it",
        "includedRegionCodes": ["it"],
    }

    if lat is not None and lon is not None:
        body["locationBias"] = {
            "circle": {
                "center": {
                    "latitude": lat,
                    "longitude": lon,
                },
                "radius": 30000.0,
            }
        }

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            GOOGLE_AUTOCOMPLETE_URL,
            json=body,
            headers={
                "X-Goog-Api-Key": settings.google_places_api_key,
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()

    results = []

    for suggestion in response.json().get("suggestions", []):
        prediction = suggestion.get("placePrediction")

        if not prediction:
            continue

        text_data = prediction.get("text") or {}

        results.append({
            "placeId": prediction.get("placeId"),
            "text": text_data.get("text"),
        })

    return results


async def google_place_details(place_id: str) -> dict | None:
    if not settings.google_places_api_key:
        return None

    field_mask = (
        "id,displayName,formattedAddress,"
        "addressComponents,location,googleMapsUri"
    )

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.get(
            GOOGLE_PLACE_DETAILS_URL.format(place_id=place_id),
            params={
                "languageCode": "it",
                "regionCode": "IT",
            },
            headers={
                "X-Goog-Api-Key": settings.google_places_api_key,
                "X-Goog-FieldMask": field_mask,
            },
        )
        response.raise_for_status()

    place = response.json()
    location = place.get("location") or {}
    address_components = place.get("addressComponents") or []

    city = None

    for component in address_components:
        types = component.get("types") or []

        if "locality" in types:
            city = component.get("longText")
            break

    if not city:
        for component in address_components:
            types = component.get("types") or []

            if "administrative_area_level_3" in types:
                city = component.get("longText")
                break

    return {
        "placeId": place.get("id"),
        "name": (place.get("displayName") or {}).get("text"),
        "address": place.get("formattedAddress"),
        "city": city,
        "latitude": location.get("latitude"),
        "longitude": location.get("longitude"),
        "googleMapsUrl": place.get("googleMapsUri"),
    }

async def tripadvisor_candidate(item: dict) -> dict | None:
    if not settings.tripadvisor_api_key:return None
    params={"key":settings.tripadvisor_api_key,"searchQuery":item["name"],"category":"restaurants","address":item.get("address") or item.get("city")}
    async with httpx.AsyncClient(timeout=8) as client:
        search=await client.get(TRIPADVISOR_SEARCH,params=params);search.raise_for_status()
        candidates=search.json().get("data") or []
        scored=[]
        for candidate in candidates:
            address=(candidate.get("address_obj") or {}).get("address_string","")
            candidate_norm={"name":candidate.get("name"),"address":address,"coordinates":{
                "lat":float(candidate["latitude"]),"lon":float(candidate["longitude"])} if candidate.get("latitude") and candidate.get("longitude") else None}
            scored.append((entity_match(item,candidate_norm),candidate,candidate_norm))
        if not scored:return None
        confidence,candidate,candidate_norm=max(scored,key=lambda row:row[0])
        if confidence<.82:return None
        details=await client.get(TRIPADVISOR_DETAILS.format(location_id=candidate["location_id"]),params={"key":settings.tripadvisor_api_key,"language":"it","currency":"EUR"})
        details.raise_for_status();data=details.json()
        return {"rating":float(data["rating"]) if data.get("rating") else None,
            "reviews":int(data["num_reviews"]) if data.get("num_reviews") else None,
            "url":data.get("web_url"),"confidence":confidence}


async def recommended_restaurants(db: Session, city: str, lat: float | None=None, lon: float | None=None, refresh: bool=False) -> dict:
    key=f"restaurants:v1:{normalized_name(city)}:{round(lat,2) if lat is not None else ''}:{round(lon,2) if lon is not None else ''}"
    if not refresh:
        cached,fresh=cache_get(db,key)
        if cached:return {**cached,"cacheFresh":fresh,"dataState":"CACHE"}
    providers={"google":"LIVE" if settings.google_places_api_key else "NOT_CONFIGURED",
        "tripadvisor":"LIVE" if settings.tripadvisor_api_key else "NOT_CONFIGURED"}
    if not settings.google_places_api_key:
        return {"location":city,"generatedAt":datetime.now(ROME).isoformat(),"providers":providers,
            "restaurants":[],"dataState":"NOT_CONFIGURED","cacheFresh":False}
    try:
        items=[item for item in await google_places(city,lat,lon) if is_typical_candidate(item)]
        if settings.tripadvisor_api_key:
            matches=await asyncio.gather(*(tripadvisor_candidate(item) for item in items[:8]),return_exceptions=True)
            for item,match in zip(items,matches):
                if isinstance(match,dict):item.update({"tripadvisorRating":match["rating"],"tripadvisorReviewCount":match["reviews"],"tripadvisorUrl":match["url"],"matchConfidence":match["confidence"]})
        for item in items:item["score"]=cross_source_score(item)
        items.sort(key=lambda item:(item["score"],item.get("googleReviewCount") or 0),reverse=True)
        value={"location":city,"generatedAt":datetime.now(ROME).isoformat(),"providers":providers,
            "restaurants":items[:8],"dataState":"LIVE","cacheFresh":True,
            "ranking":"Bayesian rating weighted by review count; Google 60% and Tripadvisor 40% only for conservative matches."}
        cache_put(db,key,value,RESTAURANT_TTL_MINUTES);return value
    except (httpx.HTTPError,ValueError,KeyError) as exc:
        logger.exception("Google Places restaurant lookup failed for city %s: %s",city,exc)
        stale,_=cache_get(db,key,allow_stale=True)
        if stale:return {**stale,"dataState":"OFFLINE","cacheFresh":False}
        return {"location":city,"generatedAt":datetime.now(ROME).isoformat(),"providers":providers,
            "restaurants":[],"dataState":"ERROR","cacheFresh":False}
