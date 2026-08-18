from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_host: str = "0.0.0.0"
    app_port: int = 8080
    port: int | None = None
    database_url: str = "sqlite:///./data/sicily.sqlite3"
    sqlite_path: str = ""
    weather_provider: str = "openmeteo"
    traffic_provider: str = "none"
    routing_provider: str = "osrm"
    tomtom_api_key: str = ""
    google_routes_api_key: str = ""
    google_places_api_key: str = ""
    tripadvisor_api_key: str = ""
    news_provider: str = "official_rss"
    allow_mock_data: bool = False
    leave_now_buffer_minutes: int = 20
    cors_origins: str = "http://localhost:8080,http://127.0.0.1:8080,http://localhost:5173,http://127.0.0.1:5173"
    model_config = SettingsConfigDict(env_file=(Path(__file__).parents[2] / ".env"), extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]

    @property
    def effective_database_url(self) -> str:
        if not self.sqlite_path:
            return self.database_url
        return f"sqlite:///{Path(self.sqlite_path).expanduser().as_posix()}"


settings = Settings()
