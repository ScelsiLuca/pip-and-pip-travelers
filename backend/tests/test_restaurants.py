import httpx
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from app.database import Base
from app.models import CacheEntry
from app import restaurants as service
from app.restaurants import bayesian_score,cross_source_score,entity_match,is_typical_candidate,normalize_google,recommended_restaurants


def db_session():
    engine=create_engine("sqlite://",connect_args={"check_same_thread":False},poolclass=StaticPool);Base.metadata.create_all(engine);return Session(engine)


def google_place(open_now=True,rating=4.7,reviews=1842):return {"id":"places/abc","displayName":{"text":"Trattoria Siciliana"},"formattedAddress":"Via Etnea, Catania","location":{"latitude":37.5,"longitude":15.08},"rating":rating,"userRatingCount":reviews,"currentOpeningHours":{"openNow":open_now},"priceLevel":"PRICE_LEVEL_MODERATE","types":["italian_restaurant","restaurant"],"googleMapsUri":"https://maps.google.com/?cid=1"}


def test_google_provider_normalization_includes_rating_count_and_url():
    item=normalize_google(google_place(),"Catania")
    assert item["googleRating"]==4.7 and item["googleReviewCount"]==1842 and item["googleMapsUrl"].startswith("https://")


def test_closed_restaurant_is_excluded():
    assert is_typical_candidate(normalize_google(google_place(False),"Catania")) is False


def test_low_review_count_does_not_outrank_established_places():
    assert bayesian_score(5,12)<bayesian_score(4.8,4500)


def test_typical_filter_rejects_fast_food():
    item=normalize_google(google_place(),"Catania");item["types"]=["fast_food_restaurant"]
    assert is_typical_candidate(item) is False


def test_entity_match_accepts_same_place_with_close_coordinates():
    google={"name":"Osteria del Centro","city":"Catania","coordinates":{"lat":37.5,"lon":15.08}}
    trip={"name":"Osteria del Centro","address":"Via Roma, Catania","coordinates":{"lat":37.5002,"lon":15.0801}}
    assert entity_match(google,trip)>=.82


def test_entity_match_rejects_ambiguous_name_only():
    assert entity_match({"name":"La Terrazza","city":"Catania"},{"name":"La Terrazza","address":"Palermo"})<.82


def test_cross_source_ranking_uses_both_review_counts():
    item={"googleRating":4.7,"googleReviewCount":2000,"tripadvisorRating":4.5,"tripadvisorReviewCount":1000,"matchConfidence":.95}
    assert 4.4<cross_source_score(item)<4.8


def test_google_only_ranking_is_available():
    item={"googleRating":4.7,"googleReviewCount":2000,"tripadvisorRating":None,"tripadvisorReviewCount":None,"matchConfidence":None}
    assert cross_source_score(item)==round(bayesian_score(4.7,2000),4)


@pytest.mark.asyncio
async def test_tripadvisor_absent_keeps_google_results(monkeypatch):
    monkeypatch.setattr(service.settings,"google_places_api_key","test");monkeypatch.setattr(service.settings,"tripadvisor_api_key","")
    item=normalize_google(google_place(),"Catania")
    async def fake(*args):return [item]
    monkeypatch.setattr(service,"google_places",fake)
    with db_session() as db:
        result=await recommended_restaurants(db,"Catania")
        assert len(result["restaurants"])==1 and result["providers"]["tripadvisor"]=="NOT_CONFIGURED"


@pytest.mark.asyncio
async def test_backend_cache_prevents_duplicate_provider_calls(monkeypatch):
    monkeypatch.setattr(service.settings,"google_places_api_key","test");monkeypatch.setattr(service.settings,"tripadvisor_api_key","");calls=0
    async def fake(*args):
        nonlocal calls;calls+=1;return [normalize_google(google_place(),"Catania")]
    monkeypatch.setattr(service,"google_places",fake)
    with db_session() as db:
        await recommended_restaurants(db,"Catania");await recommended_restaurants(db,"Catania")
        assert calls==1


@pytest.mark.asyncio
async def test_offline_returns_stale_cache(monkeypatch):
    monkeypatch.setattr(service.settings,"google_places_api_key","test");monkeypatch.setattr(service.settings,"tripadvisor_api_key","")
    async def good(*args):return [normalize_google(google_place(),"Catania")]
    monkeypatch.setattr(service,"google_places",good)
    with db_session() as db:
        await recommended_restaurants(db,"Catania")
        entry=db.get(CacheEntry,"restaurants:v1:catania::");entry.expires_at=entry.fetched_at;db.commit()
        async def broken(*args):raise httpx.ConnectError("offline")
        monkeypatch.setattr(service,"google_places",broken)
        result=await recommended_restaurants(db,"Catania")
        assert result["dataState"]=="OFFLINE" and result["restaurants"]
