from datetime import date
from pydantic import BaseModel, ConfigDict, Field


class ActivityIn(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    location: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    activity_type: str = "city"
    status: str = "planned"
    notes: str | None = None
    coordinates: dict | None = None
    address: str | None = None
    sort_order: int = 0


class ActivityOut(ActivityIn):
    id: int
    trip_day_id: int
    model_config = ConfigDict(from_attributes=True)


class ActivityPatch(BaseModel):
    title: str | None = None
    location: str | None = None
    start_time: str | None = None
    end_time: str | None = None
    activity_type: str | None = None
    status: str | None = None
    notes: str | None = None
    coordinates: dict | None = None
    address: str | None = None
    sort_order: int | None = None


class TripDayOut(BaseModel):
    id: int
    date: date
    day_number: int
    title: str | None
    base_city: str | None
    destinations: list
    points_of_interest: list
    notes: str | None
    overnight_location: str | None
    coordinates: dict | None
    status: str
    activities: list[ActivityOut]
    routes: list[dict] = []
    model_config = ConfigDict(from_attributes=True)


class SavedPlaceIn(BaseModel):
    name: str
    category: str
    latitude: float | None = None
    longitude: float | None = None
    address: str | None = None
    notes: str | None = None
    link: str | None = None


class NavigationRequest(BaseModel):
    latitude: float | None = Field(default=None, ge=-90, le=90)
    longitude: float | None = Field(default=None, ge=-180, le=180)
    simulation: bool = False
    simulation_date: date | None = None


class StopIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    city: str = Field(min_length=1, max_length=120)
    item_type: str = "poi"
    address: str | None = Field(default=None, max_length=300)
    notes: str | None = None
    coordinates: dict | None = None
    start_time: str | None = None
    end_time: str | None = None
    status: str = "planned"
    sort_order: int | None = None


class StopPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    city: str | None = Field(default=None, min_length=1, max_length=120)
    item_type: str | None = None
    address: str | None = Field(default=None, max_length=300)
    notes: str | None = None
    coordinates: dict | None = None
    start_time: str | None = None
    end_time: str | None = None
    status: str | None = None


class ReorderItem(BaseModel):
    kind: str
    id: int


class ReorderRequest(BaseModel):
    items: list[ReorderItem]


class RouteIn(BaseModel):
    origin: str
    destination: str
    origin_address: str | None = None
    destination_address: str | None = None
    origin_coordinates: dict | None = None
    destination_coordinates: dict | None = None
    planned_departure: str | None = None
    planned_duration_minutes: int | None = None
    distance_km: float | None = None
    mode: str = "car"
    sort_order: int | None = None


class RoutePatch(BaseModel):
    origin: str | None = None
    destination: str | None = None
    origin_address: str | None = None
    destination_address: str | None = None
    origin_coordinates: dict | None = None
    destination_coordinates: dict | None = None
    planned_departure: str | None = None
    planned_duration_minutes: int | None = None
    distance_km: float | None = None
    mode: str | None = None
