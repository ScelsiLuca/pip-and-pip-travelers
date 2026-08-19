from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from .config import settings


class Base(DeclarativeBase):
    pass


database_url = settings.effective_database_url
connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
engine = create_engine(database_url, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, expire_on_commit=False)


def migrate_schema() -> None:
    """Small additive SQLite migration; never drops or rewrites traveller data."""
    if engine.dialect.name != "sqlite":
        return
    additions={
        "activities":{"address":"VARCHAR(300)"},
        "routes":{
            "origin_address":"VARCHAR(300)","destination_address":"VARCHAR(300)",
            "mode":"VARCHAR(20) NOT NULL DEFAULT 'car'","sort_order":"INTEGER NOT NULL DEFAULT 0",
            "archived":"BOOLEAN NOT NULL DEFAULT 0",
        },
        # add itinerary stop times safely
        "itinerary_stops":{
            "start_time":"VARCHAR(5)",
            "end_time":"VARCHAR(5)"
        }
    }
    with engine.begin() as connection:
        known=inspect(connection)
        for table,columns in additions.items():
            existing={column["name"] for column in known.get_columns(table)}
            for name,definition in columns.items():
                if name not in existing:
                    connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {definition}"))


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
