import logging
import math
import re
import unicodedata
from datetime import datetime
import httpx
from sqlalchemy.orm import Session
from .config import settings
from .services import ROME, cache_get, cache_put


GOOGLE_NEARBY_URL = "https://places.googleapis.com/v1/places:searchNearby"
GOOGLE_AUTOCOMPLETE_URL = "https://places.googleapis.com/v1/places:autocomplete"
GOOGLE_PLACE_DETAILS_URL = "https://places.googleapis.com/v1/places/{place_id}"

RESTAURANT_TTL_MINUTES = 10

PRIMARY_RADIUS_METERS = 15_000
SECONDARY_RADIUS_METERS = 30_000

MIN_GOOGLE_RATING = 4.0
MIN_GOOGLE_REVIEWS = 40

MIN_RESULTS_BEFORE_EXPANSION = 8
MAX_GOOGLE_RESULTS = 20
MAX_RESTAURANTS_RETURNED = 8

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Utility
# ---------------------------------------------------------------------------

def normalized_name(value: str) -> str:
    plain = unicodedata.normalize("NFD", value.casefold())
    return " ".join(
        re.sub(
            r"[^a-z0-9 ]+",
            " ",
            plain.encode("ascii", "ignore").decode(),
        ).split()
    )


def distance_km(
    lat1: float,
    lon1: float,
    lat2: float,
    lon2: float,
) -> float:
    """Return straight-line GPS distance in kilometres."""
    radius = 6371.0

    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2) ** 2
        + math.cos(phi1)
        * math.cos(phi2)
        * math.sin(delta_lambda / 2) ** 2
    )

    c = 2 * math.atan2(
        math.sqrt(a),
        math.sqrt(1 - a),
    )

    return radius * c


def normalize_google(place: dict, city: str) -> dict:
    opening = place.get("currentOpeningHours") or {}
    location = place.get("location") or {}

    return {
        "placeId": place.get("id"),
        "name": (place.get("displayName") or {}).get("text"),
        "address": place.get("formattedAddress"),
        "city": city,
        "coordinates": {
            "lat": location.get("latitude"),
            "lon": location.get("longitude"),
        },
        "googleRating": place.get("rating"),
        "googleReviewCount": place.get("userRatingCount"),
        "openNow": opening.get("openNow"),
        "priceLevel": place.get("priceLevel"),
        "types": place.get("types") or [],
        "googleMapsUrl": place.get("googleMapsUri"),
        "attributions": place.get("attributions") or [],
        # Temporary compatibility with existing frontend types.
        "tripadvisorRating": None,
        "tripadvisorReviewCount": None,
        "tripadvisorUrl": None,
        "matchConfidence": None,
    }


# ---------------------------------------------------------------------------
# Restaurant filtering
# ---------------------------------------------------------------------------

def is_restaurant_candidate(item: dict) -> bool:
    """
    Keep only restaurants that are:
    - open now
    - Google rating >= 4.0
    - at least 40 Google reviews
    - not in excluded fast-food categories
    """
    text = (
        f"{item.get('name', '')} "
        f"{' '.join(item.get('types') or [])}"
    ).casefold()

    blocked = (
        "fast_food",
        "hamburger",
        "mcdonald",
        "burger king",
        "kfc",
    )

    rating = item.get("googleRating") or 0
    reviews = item.get("googleReviewCount") or 0

    return (
        item.get("openNow") is True
        and rating >= MIN_GOOGLE_RATING
        and reviews >= MIN_GOOGLE_REVIEWS
        and not any(value in text for value in blocked)
    )


# ---------------------------------------------------------------------------
# Google Nearby Search
# ---------------------------------------------------------------------------

async def google_places(
    city: str,
    lat: float | None = None,
    lon: float | None = None,
    radius_m: int = PRIMARY_RADIUS_METERS,
) -> list[dict]:
    if not settings.google_places_api_key:
        return []

    if lat is None or lon is None:
        return []

    body = {
        "includedTypes": ["restaurant"],
        "maxResultCount": MAX_GOOGLE_RESULTS,
        "rankPreference": "POPULARITY",
        "languageCode": "it",
        "regionCode": "IT",
        "locationRestriction": {
            "circle": {
                "center": {
                    "latitude": lat,
                    "longitude": lon,
                },
                "radius": float(radius_m),
            }
        },
    }

    field_mask = (
        "places.id,"
        "places.displayName,"
        "places.formattedAddress,"
        "places.location,"
        "places.rating,"
        "places.userRatingCount,"
        "places.currentOpeningHours,"
        "places.priceLevel,"
        "places.types,"
        "places.googleMapsUri,"
        "places.attributions"
    )

    async with httpx.AsyncClient(timeout=10) as client:
        response = await client.post(
            GOOGLE_NEARBY_URL,
            json=body,
            headers={
                "X-Goog-Api-Key": settings.google_places_api_key,
                "X-Goog-FieldMask": field_mask,
                "Content-Type": "application/json",
            },
        )
        response.raise_for_status()

    return [
        normalize_google(place, city)
        for place in response.json().get("places", [])
    ]


# ---------------------------------------------------------------------------
# Google Places autocomplete
# ---------------------------------------------------------------------------

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
                "radius": 30_000.0,
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

        results.append(
            {
                "placeId": prediction.get("placeId"),
                "text": text_data.get("text"),
            }
        )

    return results


# ---------------------------------------------------------------------------
# Google Place Details
# ---------------------------------------------------------------------------

async def google_place_details(place_id: str) -> dict | None:
    if not settings.google_places_api_key:
        return None

    field_mask = (
        "id,"
        "displayName,"
        "formattedAddress,"
        "addressComponents,"
        "location,"
        "googleMapsUri"
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


# ---------------------------------------------------------------------------
# Recommended restaurants
# ---------------------------------------------------------------------------

async def recommended_restaurants(
    db: Session,
    city: str,
    lat: float | None = None,
    lon: float | None = None,
    refresh: bool = False,
) -> dict:
    """
    Recommend restaurants from the real GPS position.

    Ranking priority:
    1. Higher Google rating
    2. Shorter GPS distance
    3. Higher Google review count
    """

    lat_key = round(lat, 3) if lat is not None else ""
    lon_key = round(lon, 3) if lon is not None else ""

    key = f"restaurants:v3:{lat_key}:{lon_key}"

    if not refresh:
        cached, fresh = cache_get(db, key)

        if cached:
            return {
                **cached,
                "cacheFresh": fresh,
                "dataState": "CACHE",
            }

    providers = {
        "google": (
            "LIVE"
            if settings.google_places_api_key
            else "NOT_CONFIGURED"
        ),
        # Temporary compatibility with existing RestaurantResponse.
        "tripadvisor": "REMOVED",
    }

    if not settings.google_places_api_key:
        return {
            "location": city,
            "generatedAt": datetime.now(ROME).isoformat(),
            "providers": providers,
            "restaurants": [],
            "dataState": "NOT_CONFIGURED",
            "cacheFresh": False,
            "searchRadiusKm": None,
        }

    if lat is None or lon is None:
        return {
            "location": city,
            "generatedAt": datetime.now(ROME).isoformat(),
            "providers": providers,
            "restaurants": [],
            "dataState": "GPS_REQUIRED",
            "cacheFresh": False,
            "searchRadiusKm": None,
            "message": (
                "Posizione GPS necessaria "
                "per cercare i ristoranti vicini."
            ),
        }

    try:
        # ---------------------------------------------------------
        # Primary search: 15 km
        # ---------------------------------------------------------
        primary_results = await google_places(
            city,
            lat,
            lon,
            radius_m=PRIMARY_RADIUS_METERS,
        )

        items = [
            item
            for item in primary_results
            if is_restaurant_candidate(item)
        ]

        search_radius_km = 15

        # ---------------------------------------------------------
        # Expand to 30 km only if fewer than 5 valid candidates.
        # ---------------------------------------------------------
        if len(items) < MIN_RESULTS_BEFORE_EXPANSION:
            secondary_results = await google_places(
                city,
                lat,
                lon,
                radius_m=SECONDARY_RADIUS_METERS,
            )

            wider_items = [
                item
                for item in secondary_results
                if is_restaurant_candidate(item)
            ]

            by_id = {
                item["placeId"]: item
                for item in items
                if item.get("placeId")
            }

            for item in wider_items:
                place_id = item.get("placeId")

                if place_id:
                    by_id[place_id] = item

            items = list(by_id.values())
            search_radius_km = 30

        # ---------------------------------------------------------
        # GPS distance for ranking
        # ---------------------------------------------------------
        for item in items:
            coordinates = item.get("coordinates") or {}

            restaurant_lat = coordinates.get("lat")
            restaurant_lon = coordinates.get("lon")

            if (
                restaurant_lat is not None
                and restaurant_lon is not None
            ):
                item["distanceKm"] = round(
                    distance_km(
                        lat,
                        lon,
                        restaurant_lat,
                        restaurant_lon,
                    ),
                    2,
                )
            else:
                item["distanceKm"] = None

        # ---------------------------------------------------------
        # Ranking:
        # 1. rating descending
        # 2. distance ascending
        # 3. review count descending
        # ---------------------------------------------------------
        items.sort(
            key=lambda item: (
                -(item.get("googleRating") or 0),
                (
                    item.get("distanceKm")
                    if item.get("distanceKm") is not None
                    else float("inf")
                ),
                -(item.get("googleReviewCount") or 0),
            )
        )

        restaurants = items[:MAX_RESTAURANTS_RETURNED]

        value = {
            "location": city,
            "generatedAt": datetime.now(ROME).isoformat(),
            "providers": providers,
            "restaurants": restaurants,
            "dataState": "LIVE",
            "cacheFresh": True,
            "searchRadiusKm": search_radius_km,
            "origin": {
                "lat": lat,
                "lon": lon,
            },
            "ranking": (
                "Google rating descending, "
                "GPS distance ascending, "
                "review count descending. "
                f"Minimum rating {MIN_GOOGLE_RATING}, "
                f"minimum {MIN_GOOGLE_REVIEWS} reviews."
            ),
        }

        cache_put(
            db,
            key,
            value,
            RESTAURANT_TTL_MINUTES,
        )

        return value

    except (
        httpx.HTTPError,
        ValueError,
        KeyError,
    ) as exc:
        logger.exception(
            "Google Places restaurant lookup failed "
            "near GPS %.6f, %.6f: %s",
            lat,
            lon,
            exc,
        )

        stale, _ = cache_get(
            db,
            key,
            allow_stale=True,
        )

        if stale:
            return {
                **stale,
                "dataState": "OFFLINE",
                "cacheFresh": False,
            }

        return {
            "location": city,
            "generatedAt": datetime.now(ROME).isoformat(),
            "providers": providers,
            "restaurants": [],
            "dataState": "ERROR",
            "cacheFresh": False,
            "searchRadiusKm": None,
        }
