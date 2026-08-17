from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_host: str = "0.0.0.0"
    app_port: int = 8080
    database_url: str = "sqlite:///./data/sicily.sqlite3"
    weather_provider: str = "openmeteo"
    traffic_provider: str = "none"
    routing_provider: str = "osrm"
    tomtom_api_key: str = ""
    google_routes_api_key: str = ""
    news_provider: str = "official_rss"
    allow_mock_data: bool = False
    leave_now_buffer_minutes: int = 20
    cors_origins: str = "http://localhost:8080,http://127.0.0.1:8080"
    model_config = SettingsConfigDict(env_file=(Path(__file__).parents[2] / ".env"), extra="ignore")

    @property
    def origins(self) -> list[str]:
        return [item.strip() for item in self.cors_origins.split(",") if item.strip()]


settings = Settings()
