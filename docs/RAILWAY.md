# Railway backend setup

1. In Railway choose **New Project → Deploy from GitHub repo** and select `pip-and-pip-travelers`.
2. Open the service settings and set **Root Directory** to `/backend`. Railway will use `backend/Dockerfile` and `backend/railway.toml`.
3. Add a Railway Volume and set its **Mount Path** to `/data`.
4. Add these service variables:

   ```text
   SQLITE_PATH=/data/sicily.sqlite3
   CORS_ORIGINS=https://YOUR-PWA-DOMAIN
   GOOGLE_PLACES_API_KEY=YOUR_SECRET_VALUE
   TRIPADVISOR_API_KEY=YOUR_SECRET_VALUE_OR_EMPTY
   GOOGLE_ROUTES_API_KEY=YOUR_SECRET_VALUE_OR_EMPTY
   TOMTOM_API_KEY=YOUR_SECRET_VALUE_OR_EMPTY
   WEATHER_PROVIDER=openmeteo
   ROUTING_PROVIDER=osrm
   TRAFFIC_PROVIDER=none
   NEWS_PROVIDER=official_rss
   ALLOW_MOCK_DATA=false
   LEAVE_NOW_BUFFER_MINUTES=20
   ```

   Do not set `PORT`: Railway provides it automatically. Do not set `DATABASE_URL` when using `SQLITE_PATH`.
5. Under **Networking**, choose **Generate Domain**.
6. Verify `https://YOUR-RAILWAY-DOMAIN/health`; it must return `{"status":"ok"}`.
7. Copy the generated HTTPS service URL without a trailing slash.
8. Set the frontend build variable to `VITE_API_BASE_URL=https://YOUR-RAILWAY-DOMAIN`, then rebuild the frontend/PWA. Replace `CORS_ORIGINS` with the real HTTPS origin serving that PWA; multiple origins must be comma-separated and must not include paths.

The backend start command supplied by its Dockerfile is:

```text
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}
```
