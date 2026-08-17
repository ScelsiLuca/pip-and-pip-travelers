from datetime import date, datetime
from sqlalchemy import Boolean, Date, DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from .database import Base


class TripDay(Base):
    __tablename__ = "trip_days"
    id: Mapped[int] = mapped_column(primary_key=True)
    date: Mapped[date] = mapped_column(Date, unique=True, index=True)
    day_number: Mapped[int] = mapped_column(Integer, unique=True)
    title: Mapped[str | None] = mapped_column(String(160), nullable=True)
    base_city: Mapped[str | None] = mapped_column(String(100), nullable=True)
    destinations: Mapped[list] = mapped_column(JSON, default=list)
    points_of_interest: Mapped[list] = mapped_column(JSON, default=list)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    overnight_location: Mapped[str | None] = mapped_column(String(100), nullable=True)
    coordinates: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned")
    activities: Mapped[list["Activity"]] = relationship(cascade="all, delete-orphan", order_by="Activity.sort_order")
    stops: Mapped[list["ItineraryStop"]] = relationship(cascade="all, delete-orphan", order_by="ItineraryStop.sort_order")
    routes: Mapped[list["Route"]] = relationship(cascade="all, delete-orphan", order_by="Route.sort_order")


class Activity(Base):
    __tablename__ = "activities"
    id: Mapped[int] = mapped_column(primary_key=True)
    trip_day_id: Mapped[int] = mapped_column(ForeignKey("trip_days.id"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    location: Mapped[str | None] = mapped_column(String(120), nullable=True)
    start_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    end_time: Mapped[str | None] = mapped_column(String(5), nullable=True)
    activity_type: Mapped[str] = mapped_column(String(30), default="city")
    status: Mapped[str] = mapped_column(String(20), default="planned")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    coordinates: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)


class ItineraryStop(Base):
    __tablename__ = "itinerary_stops"
    id: Mapped[int] = mapped_column(primary_key=True)
    trip_day_id: Mapped[int] = mapped_column(ForeignKey("trip_days.id"), index=True)
    name: Mapped[str] = mapped_column(String(200))
    city: Mapped[str] = mapped_column(String(120))
    item_type: Mapped[str] = mapped_column(String(30), default="poi")
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    coordinates: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="planned")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    original_key: Mapped[str | None] = mapped_column(String(260), nullable=True, unique=True)


class Route(Base):
    __tablename__ = "routes"
    id: Mapped[int] = mapped_column(primary_key=True)
    trip_day_id: Mapped[int] = mapped_column(ForeignKey("trip_days.id"), index=True)
    origin: Mapped[str] = mapped_column(String(120))
    destination: Mapped[str] = mapped_column(String(120))
    origin_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    destination_address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    origin_coordinates: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    destination_coordinates: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    planned_departure: Mapped[str | None] = mapped_column(String(5), nullable=True)
    planned_duration_minutes: Mapped[int | None] = mapped_column(nullable=True)
    distance_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    mode: Mapped[str] = mapped_column(String(20), default="car")
    sort_order: Mapped[int] = mapped_column(Integer, default=0, index=True)
    archived: Mapped[bool] = mapped_column(Boolean, default=False, index=True)


class ChecklistItem(Base):
    __tablename__ = "checklist_items"
    __table_args__ = (UniqueConstraint("trip_day_id", "label"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    trip_day_id: Mapped[int] = mapped_column(ForeignKey("trip_days.id"), index=True)
    label: Mapped[str] = mapped_column(String(160))
    checked: Mapped[bool] = mapped_column(Boolean, default=False)
    category: Mapped[str] = mapped_column(String(30), default="general")


class SavedPlace(Base):
    __tablename__ = "saved_places"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(160))
    category: Mapped[str] = mapped_column(String(30))
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    address: Mapped[str | None] = mapped_column(String(240), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    link: Mapped[str | None] = mapped_column(String(500), nullable=True)


class CacheEntry(Base):
    __tablename__ = "cached_api_data"
    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
