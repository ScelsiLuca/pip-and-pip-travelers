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
