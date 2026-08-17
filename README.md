# Pip & Pip Travelers

Dashboard locale e PWA per il viaggio dal 21 agosto al 4 settembre 2026. Il seed deriva da `Sicily.pdf`; orari e giorni non specificati nel documento restano volutamente vuoti.

## Avvio rapido

```powershell
Copy-Item .env.example .env
.\start-dashboard.ps1
```

Oppure `docker compose up -d --build`. Aprire <http://localhost:8080>. Arresto: `.\stop-dashboard.ps1`.

Per iPhone/iPad, collegare telefono e PC alla stessa rete e aprire l'URL LAN stampato dallo script, per esempio `http://192.168.1.50:8080`. Il servizio ascolta su `0.0.0.0`; il frontend usa URL API relativi e non dipende da `localhost`. Se necessario consentire TCP 8080 soltanto sul profilo **Privato** di Windows Firewall.

## Working

- Itinerario reale di 15 giorni importato da `Sicily.pdf`, con POI, trasferimenti `>>>`, note e giorni vuoti conservati fedelmente.
- Coordinate locali revisionate per le tappe principali non ambigue; POI dubbi rimangono senza coordinate.
- Mappa Leaflet con modalità Oggi/Intero viaggio, marker, link Google/Apple Maps e geometrie OSRM quando disponibili.
- Contesto viaggio centralizzato (`/api/trip/context/current`) usato da dashboard e provider.
- Open-Meteo contestuale e Open-Meteo Marine per giornate mare/boat.
- Routing base OSRM con distanza, durata, GeoJSON e cache SQLite.
- Parser dell'ultimo comunicato Etna INGV con timestamp, link originale e cache; mostra `ERROR/OFFLINE` se la pagina non è raggiungibile o cambia formato.
- Alert meteo oggettivi, ordinamento geografico, cache e fallback all'ultimo dato valido.
- CRUD attività; patch rapido per completata/saltata; nessuno stato viene dedotto soltanto dalla data.
- PWA/offline shell, SQLite persistente, Docker e health check.

## Optional / requires API key

TomTom Routing API sovrappone durata live e ritardo traffico al routing OSRM:

```env
TRAFFIC_PROVIDER=tomtom
TOMTOM_API_KEY=...
```

Endpoint implementato: `GET https://api.tomtom.com/routing/1/calculateRoute/{locations}/json` con `traffic=true`, `routeType=fastest`, `travelMode=car`. La chiave viene usata soltanto dal backend.

Google Routes API è disponibile come alternativa backend-only:

```env
ROUTING_PROVIDER=google
TRAFFIC_PROVIDER=google
GOOGLE_ROUTES_API_KEY=...
```

L'integrazione usa `POST https://routes.googleapis.com/directions/v2:computeRoutes`, `DRIVE`, `TRAFFIC_AWARE` e un field mask limitato a distanza, durata, durata statica e polyline. Se Google non è configurato o fallisce, il routing torna a OSRM. Google Maps per la navigazione non richiede questa chiave: il link viene aperto soltanto su comando dell'utente.

## Posizione corrente e privacy

“Usa posizione attuale” è disattivato per default. Attivandolo, il browser richiede il consenso; le coordinate restano in memoria, non vengono salvate nel database e vengono inviate soltanto a `/api/navigation/next`. Il GPS ha precedenza sulla posizione pianificata. Con permesso negato la dashboard continua a funzionare e mostra `PLANNED LOCATION` o `LOCATION UNAVAILABLE`.

La posizione viene aggiornata all'apertura, manualmente e tramite `watchPosition`; una nuova richiesta di percorso viene fatta soltanto dopo uno spostamento di almeno 100 metri. Simulation Mode disattiva sempre il GPS reale.

## HTTPS locale per iPhone/iPad

La Browser Geolocation API richiede un secure context; `http://192.168.x.x:8080` non è normalmente sufficiente. HTTP rimane disponibile come fallback senza GPS.

1. Installare [mkcert](https://github.com/FiloSottile/mkcert) su Windows.
2. Eseguire `.\setup-https.ps1`; crea un certificato per localhost e l'IP LAN.
3. Trasferire **solo** `certs\rootCA.pem` sull'iPhone.
4. Su iPhone aprire il file, installare il profilo in Impostazioni, quindi abilitare la fiducia completa in Impostazioni → Generali → Info → Impostazioni attendibilità certificati.
5. Avviare `.\start-dashboard-https.ps1`.
6. Aprire `https://<IP-LAN>:8443`.

Non condividere mai `rootCA-key.pem` o `sicily-key.pem`. Non aggirare gli avvisi TLS: se Safari mostra un errore, correggere installazione, trust o SAN del certificato.

## Not implemented

- News contestuali multi-fonte e allerte aeroporti/traghetti.
- Feed Protezione Civile/SAC aggiuntivi.
- Geocoding automatico precompilato: lo script Nominatim è disponibile ma non è stato eseguito automaticamente perché invierebbe i nomi del PDF a un servizio pubblico.
- Riordino drag-and-drop e form completo inline per note/luogo; l'API supporta patch parziali.

La UI non trasforma queste assenze in “nessun problema”: mostra stati espliciti.

## Geocoding consapevole

`backend/scripts/geocode_itinerary.py` effettua richieste seriali a Nominatim, massimo una al secondo, e salva la cache in `backend/data/geocoding.json`. Eseguirlo solo se si accetta di inviare i nomi delle tappe a OpenStreetMap:

```powershell
python backend\scripts\geocode_itinerary.py
```

## API

- `/health`
- `/api/status`
- `/api/trip`, `/api/trip/today`, `/api/trip/tomorrow`
- `/api/trip/context/current`
- `/api/dashboard/today`
- `/api/routes/{day_id}`
- `/api/weather/{location}?lat=...&lon=...`
- `/api/sea/{location}?lat=...&lon=...`
- `/api/etna/status`
- `POST /api/navigation/next`

## Sviluppo e test

```powershell
$env:PYTHONPATH='backend'
pytest backend\tests
Set-Location frontend
pnpm run build
```

Il database è `data/sicily.sqlite3`. Il seed sostituisce automaticamente solo lo skeleton vuoto della prima iterazione; non sovrascrive un itinerario già modificato.

## Web/PWA e Android

La stessa codebase React supporta Web/PWA e l'app Android **Pip & Pip Travelers** (`com.pipandpip.travelers`) tramite Capacitor. GPS, rete, preferenze e navigazione esterna usano API native su Android e fallback web nel browser.

```powershell
Set-Location frontend
npm run build
npm run android:sync
npm run android:debug
```

Per configurazione Android, Samsung A55, firma e aggiornamenti vedere [docs/ANDROID.md](docs/ANDROID.md). La build release richiede `VITE_API_BASE_URL` verso un backend FastAPI pubblico HTTPS; le chiavi dei provider restano esclusivamente sul backend.
