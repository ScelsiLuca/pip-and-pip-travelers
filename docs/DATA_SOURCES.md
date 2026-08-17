# Fonti dati live

Verificate il 17 agosto 2026 su documentazione o pagine ufficiali. `READY` significa configurato ma non interrogato dall'health check; `LIVE` viene usato soltanto dopo una risposta valida.

| Purpose | Provider | Official URL | Authentication / free tier | Refresh | Cache / fallback | Status |
|---|---|---|---|---:|---|---|
| Forecast meteo | Open-Meteo | https://open-meteo.com/en/docs | Nessuna chiave per API pubblica non commerciale; limiti pubblicati | 15 min | SQLite; ultimo dato valido | Working |
| Onde e mare | Open-Meteo Marine | https://open-meteo.com/en/docs/marine-weather-api | Nessuna chiave per API pubblica non commerciale | 20 min | SQLite; ultimo dato valido | Working |
| Routing base | OSRM demo | https://project-osrm.org/docs/v5.24.0/api/ | Nessuna chiave; servizio best effort, senza SLA | 24 h | SQLite; ultimo percorso valido | Working |
| Traffico/routing live | TomTom Routing API | https://developer.tomtom.com/routing-api/documentation/routing/calculate-route | API key; pagina prezzi indica 20.000 richieste routing/mese gratuite e avvio senza carta | 5 min | SQLite; fallback OSRM | Optional |
| Routing e traffico | Google Routes API | https://developers.google.com/maps/documentation/routes | API key e billing; free usage cap dipendente dallo SKU | 5 min traffico / 24 h statico | SQLite; fallback OSRM | Optional |
| Etna | INGV Osservatorio Etneo | https://www.ct.ingv.it/sezioniesterne/UltimiAggiornamenti.php | Nessuna autenticazione | 10 min | SQLite; ultimo comunicato valido | Working, parser HTML controllato |
| Bollettini Etna | INGV OE | https://www.ct.ingv.it/index.php/monitoraggio-e-sorveglianza/prodotti-del-monitoraggio/bollettini-settimanali-multidisciplinari | Nessuna autenticazione | Manuale/link | Pagina ufficiale | Referenced |
| Geocoding | OpenStreetMap Nominatim | https://operations.osmfoundation.org/policies/nominatim/ | Nessuna chiave; massimo assoluto 1 richiesta/s, User-Agent e cache obbligatori | Solo import/user action | JSON/SQLite annuale; catalogo locale | Implemented, manual opt-in |
| Map tiles | OpenStreetMap | https://operations.osmfoundation.org/policies/tiles/ | Best effort | Cache HTTP browser | Nessun prefetch/bulk download | Working |
| News contestuali | - | - | - | - | - | Not implemented |

## Trasparenza

Ogni payload live include `dataState`, `provider`, `updatedAt` e, quando disponibile, `sourceUrl`. Gli stati possibili sono `LIVE`, `CACHE`, `OFFLINE`, `ERROR`, `READY`, `NOT_CONFIGURED` e `UNAVAILABLE`. Un array alert vuoto significa soltanto che nessun alert è stato generato dai dati effettivamente disponibili.

L'indicatore TomTom deriva `trafficDelayMinutes` dalla differenza fra `travelTimeInSeconds` e `noTrafficTravelTimeInSeconds`; non viene simulato. Il modulo Etna riporta il testo INGV senza convertirlo in un giudizio “safe”.

Google Routes usa `duration` come durata traffic-aware e `staticDuration` come durata senza traffico; il ritardo è calcolato solo quando entrambi sono presenti. La chiamata usa un field mask esplicito per evitare campi e costi non necessari. La geolocalizzazione browser richiede HTTPS fuori da localhost e viene inviata a un provider di routing soltanto quando serve calcolare il percorso richiesto.
