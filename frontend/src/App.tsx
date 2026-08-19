import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import L from "leaflet";
import { api } from "./api";
import type { Coordinates, LiveData, RouteLive, Trip, TripDay } from "./types";
import LocationNavigation from "./LocationNavigation";
import OperationalMap,{type TripLeg} from "./OperationalMap";
import{travelStatus}from'./alertStatus';
import{getUserFacingProviderStatus}from'./providerStatus';
import{BottomSheet,GuideView,ModernTripView}from'./TravelExperience';
import{RestaurantCarousel}from'./RestaurantCarousel';
import{nextStop}from'./tripModel';
import{platformService,type DevicePosition}from'./services/platformService';
import{FoodRecommendations,OptionalStops}from'./SavedPlaces';

const months = [
  "gennaio",
  "febbraio",
  "marzo",
  "aprile",
  "maggio",
  "giugno",
  "luglio",
  "agosto",
  "settembre",
  "ottobre",
  "novembre",
  "dicembre",
];
const short = [
  "GEN",
  "FEB",
  "MAR",
  "APR",
  "MAG",
  "GIU",
  "LUG",
  "AGO",
  "SET",
  "OTT",
  "NOV",
  "DIC",
];
const fmt = (iso: string) => {
  const d = new Date(`${iso}T12:00:00`);
  return `${d.getDate()} ${months[d.getMonth()]}`;
};
const distanceKm=(a:Coordinates,b:Coordinates)=>{const rad=(value:number)=>value*Math.PI/180,dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon),lat1=rad(a.lat),lat2=rad(b.lat);return 6371*2*Math.asin(Math.sqrt(Math.sin(dLat/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2))};
const mapsDestination=(stop:{coordinates:Coordinates|null;address?:string|null;name:string;city:string})=>stop.coordinates?`${stop.coordinates.lat},${stop.coordinates.lon}`:stop.address?.trim()||`${stop.name}, ${stop.city}, Italia`;
const marker = L.divIcon({
  className: "pin",
  html: "<span>●</span>",
  iconSize: [28, 28],
});
type View = "today" | "trip" | "map" | "guide" | "alerts" | "more";

function State({ data }: { data: LiveData }) {
  const status=getUserFacingProviderStatus(data.dataState,data.updatedAt);
  return (
    <span className={`state ${status.tone}`} title={status.detail}>
      {status.label}
    </span>
  );
}
function Weather({ data, location }: { data: LiveData; location?:string|null }) {
  const c = data.current;
  const weatherCode=Number(c?.weather_code??-1);
  const condition=weatherCode===0?'Sereno':weatherCode<=3?'Poco nuvoloso':weatherCode<=67?'Pioggia':weatherCode<=77?'Neve':weatherCode>=95?'Temporali':'Condizioni variabili';
  return (
    <article className="card weather">
      <div className="card-head">
        <span>METEO · {location||"Posizione non disponibile"}</span>
        <State data={data} />
      </div>
      {c ? (
        <>
          <div className="big-value">
            {Math.round(Number(c.temperature_2m))}°
          </div>
          <p className="weather-condition">{condition}</p>
          <div className="metrics">
            <span>Percepiti {Math.round(Number(c.apparent_temperature))}°</span>
            <span>Vento {Math.round(Number(c.wind_speed_10m))} km/h</span>
            <span>Umidità {c.relative_humidity_2m}%</span>
          </div>
        </>
      ) : (
        <Empty text={data.message || "Meteo non disponibile"} />
      )}
      <Fresh data={data} />
    </article>
  );
}
function Fresh({ data }: { data: LiveData }) {
  return data.updatedAt ? (
    <small className="fresh">
      Aggiornato{" "}
      {new Date(data.updatedAt).toLocaleTimeString("it-IT", {
        hour: "2-digit",
        minute: "2-digit",
      })}{" "}
      {data.dataState==='CACHE'||data.dataState==='OFFLINE'?' · dati salvati':''}
    </small>
  ) : null;
}
function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>;
}
type Dashboard = {
  day: TripDay | null;
  context: Record<string, unknown>;
  weather: LiveData;
  traffic: LiveData;
  routing: RouteLive;
  sea: LiveData;
  alerts: Array<{ title: string; description: string;level?:string }>;
  news: unknown[];
  weatherLocation?:string|null;
  newsLocation?:string|null;
  liveLocationSource?:string;
  etna: LiveData & { title?: string; summary?: string; sourceUrl?: string };
  nextTripLeg:TripLeg|null;
  alertCoverage:Record<string,string>;
  alertCoverageState:"FULL"|"PARTIAL";
};

type RouteOption = {
  available: boolean;
  dataState: string;
  durationMinutes: number | null;
  distanceKm: number | null;
  trafficDelayMinutes?: number | null;
  updatedAt?: string | null;
};

type RouteOptions = {
  car: RouteOption;
  walk: RouteOption;
  transit: RouteOption;
};

function formatRouteDuration(value: number | null) {
  if (value == null) return "—";

  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(value / 60);
  const minutes = value % 60;

  return minutes
    ? `${hours} h ${minutes} min`
    : `${hours} h`;
}

function formatRouteDistance(value: number | null) {
  if (value == null) return "—";

  if (value < 1) {
    return `${Math.round(value * 1000)} m`;
  }

  return `${value.toFixed(1).replace(".", ",")} km`;
}

function Today({
  trip,
  refreshToken,
  onRefresh,
  onGuide,
}: {
  trip: Trip;
  refreshToken: number;
  onRefresh: () => void;
  onGuide: (name: string) => void;
}) {
  const [live, setLive] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [nextStopRoutes, setNextStopRoutes] =
  useState<RouteOptions | null>(null);
  const [nextStopRoutesLoading, setNextStopRoutesLoading] =
  useState(false);
  const [simulation, setSimulation] = useState({
    enabled: false,
    date: "2026-08-21",
  });

  const [mapPosition, setMapPosition] = useState<Coordinates | null>(null);
  const [realPosition, setRealPosition] = useState<DevicePosition | null>(null);
  const [simulatedPosition, setSimulatedPosition] = useState<{
    date: string;
    coordinates: Coordinates;
  } | null>(null);
  const [gpsResolved, setGpsResolved] = useState(false);

  const latestRealPosition = useRef<DevicePosition | null>(null);

  const acceptRealPosition = (next: DevicePosition) => {
    setGpsResolved(true);

    const previous = latestRealPosition.current;
    if (
  previous &&
  distanceKm(previous, next) < 0.25
) {
  return;
}

    latestRealPosition.current = next;
    setLive(null);
    setLoading(true);
    setRealPosition(next);
    setMapPosition(next);
  };

  useEffect(() => {
    let active = true;
    let watch: { remove: () => Promise<void> } | null = null;

    const refresh = () =>
      platformService
        .currentPosition()
        .then((position) => {
          if (active) acceptRealPosition(position);
        })
        .catch(() => {
          if (active) setGpsResolved(true);
        });

    void refresh();

    platformService
      .watchPosition((position) => {
        if (active) acceptRealPosition(position);
      })
      .then((value) => {
        watch = value;
        if (!active) void value.remove();
      })
      .catch(() => {});

    const foreground = () => {
      const age =
        Date.now() -
        new Date(latestRealPosition.current?.updatedAt || 0).getTime();

      if (
        document.visibilityState === "visible" &&
        age > 120000
      ) {
        void refresh();
      }
    };

    document.addEventListener("visibilitychange", foreground);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", foreground);
      void watch?.remove();
    };
  }, []);

  const effectiveDate = simulation.enabled
    ? simulation.date
    : trip.context.today;

  const simulatedDay = useMemo(
    () =>
      trip.days.find((item) => item.date === simulation.date) ||
      null,
    [trip.days, simulation.date],
  );

  const defaultSimulatedPosition =
    simulatedDay?.coordinates || null;

  const selectableSimulatedPositions = useMemo(
    () =>
      trip.days
        .flatMap((item) => [
          item.coordinates,
          ...item.routes.flatMap((route) => [
            route.originCoordinates,
            route.destinationCoordinates,
          ]),
        ])
        .filter(
          (position): position is Coordinates =>
            Boolean(position),
        ),
    [trip.days],
  );

  const selectedSimulatedPosition =
    simulatedPosition?.date === simulation.date
      ? simulatedPosition.coordinates
      : null;

  const effectiveLivePosition = simulation.enabled
    ? selectedSimulatedPosition || defaultSimulatedPosition
    : realPosition;

  const effectiveLiveReady = simulation.enabled
    ? Boolean(effectiveLivePosition)
    : gpsResolved;

  useEffect(() => {
    if (!effectiveLiveReady) return;

    const controller = new AbortController();

    setLive(null);
    setLoading(true);

    const params = new URLSearchParams({
      date: effectiveDate,
    });

    if (effectiveLivePosition) {
      params.set(
        "latitude",
        String(effectiveLivePosition.lat),
      );
      params.set(
        "longitude",
        String(effectiveLivePosition.lon),
      );
      params.set(
        "live_source",
        simulation.enabled ? "SIMULATION" : "GPS",
      );
    }

    api<Dashboard>(
      `/api/dashboard/today?${params}`,
      { signal: controller.signal },
    )
      .then((value) => {
        if (!controller.signal.aborted) {
          setLive(value);
        }
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          setLive(null);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, [
    refreshToken,
    effectiveDate,
    effectiveLiveReady,
    effectiveLivePosition?.lat,
    effectiveLivePosition?.lon,
    simulation.enabled,
  ]);

  const day = live?.day;
  const context = live?.context || trip.context;
  const kind = day?.activityType || "city";

  const dayNumber = Number(context.dayNumber || 0);
  const remainingDays = Number(context.remainingDays || 0);
  const phase = String(context.phase || "before");
  const progress = dayNumber
    ? Math.round((dayNumber / 15) * 100)
    : 0;

  const situation = travelStatus(
    live?.alerts || [],
    live?.alertCoverageState || "PARTIAL",
  );

  /*
   * Quando il viaggio non è ancora iniziato (o non esiste
   * una giornata live), la Home usa la prima giornata del
   * viaggio come contesto di scoperta invece della posizione
   * GPS reale dell'utente.
   */
  const fallbackDay =
    trip.days.find((item) => item.date >= trip.context.today) ||
    trip.days[0] ||
    null;

  const homeDay = day || fallbackDay;

  const primaryLocation = String(
    (context as Record<string, unknown>).primaryLocation ||
      homeDay?.baseCity ||
      homeDay?.title ||
      "Sicilia",
  );

  const stop = day ? nextStop(day) : null;
  const nextStopOrigin = realPosition;
  const discoveryStop = stop || (homeDay ? nextStop(homeDay) : null);

  const recommendationLocation = (() => {
    const stopCity = discoveryStop?.city?.trim();
    const baseCity = homeDay?.baseCity?.trim();

    if (stopCity) {
      const normalized = stopCity.toLowerCase();

      if (
        normalized === "isola bella" ||
        normalized.includes("taormina")
      ) {
        return "Taormina";
      }

      return stopCity;
    }

    return baseCity || primaryLocation.split(",")[0];
  })();

  useEffect(() => {
    if (!stop?.coordinates || !nextStopOrigin) {
      setNextStopRoutes(null);
      setNextStopRoutesLoading(false);
      return;
    }

    const origin: Coordinates = {
      lat: nextStopOrigin.lat,
      lon: nextStopOrigin.lon,
    };

    const destination: Coordinates = {
      lat: stop.coordinates.lat,
      lon: stop.coordinates.lon,
    };

    let active = true;

    const loadNextStopRoutes = async () => {
      if (active) {
        setNextStopRoutesLoading(true);
      }

      try {
        const result = await api<RouteOptions>(
          "/api/routes/options",
          {
            method: "POST",
            body: JSON.stringify({
              origin,
              destination,
            }),
          },
        );

        if (active) {
          setNextStopRoutes(result);
        }
      } catch (error) {
        console.error(
          "Errore calcolo percorso prossima tappa:",
          error,
        );

        if (active) {
          setNextStopRoutes(null);
        }
      } finally {
        if (active) {
          setNextStopRoutesLoading(false);
        }
      }
    };

    void loadNextStopRoutes();

    const interval = window.setInterval(
      () => void loadNextStopRoutes(),
      5 * 60 * 1000,
    );

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [
    stop?.id,
    stop?.coordinates?.lat,
    stop?.coordinates?.lon,
    nextStopOrigin?.lat,
    nextStopOrigin?.lon,
    simulation.enabled,
  ]);

  /*
   * In simulazione usiamo la posizione simulata.
   * Durante il viaggio usiamo la posizione live.
   * Prima del viaggio usiamo le coordinate della giornata
   * di riferimento, evitando distanze Roma -> Sicilia.
   */
  const discoveryPosition: Coordinates | null =
    simulation.enabled
      ? effectiveLivePosition
      : day
        ? mapPosition || effectiveLivePosition
        : homeDay?.coordinates || null;

  const relevantServices: Array<
    [string, LiveData | undefined]
  > = [["Meteo", live?.weather]];

  if (kind === "etna") {
    relevantServices.push(["Etna", live?.etna]);
  }

  if (kind === "sea" || kind === "boat_trip") {
    relevantServices.push(["Mare", live?.sea]);
  }

  return (
    <main>
      <header className="hero">
        <div>
          <p className="eyebrow">
            {fmt(effectiveDate).toUpperCase()} ·{" "}
            {dayNumber
              ? `DAY ${dayNumber} / 15`
              : phase === "before"
                ? "IL VIAGGIO SI AVVICINA"
                : "VIAGGIO CONCLUSO"}
          </p>

          <h1>Pip &amp; Pip Travelers</h1>
          <p className="sub">
            Il nostro viaggio in Sicilia
          </p>

          {dayNumber > 0 && (
            <p className="hero-location">
              {primaryLocation} · Sicilia
            </p>
          )}

          {dayNumber > 0 && (
            <div className="progress">
              <span
                style={{
                  width: `${progress}%`,
                }}
              />
              <small>
                {progress}% temporale · {remainingDays} giorni
                rimanenti
              </small>
            </div>
          )}
        </div>

        <button
          className="refresh"
          onClick={onRefresh}
          aria-label="Aggiorna"
        >
          ↻
        </button>
      </header>

      {!navigator.onLine && (
        <div className="offline">
          OFFLINE · visualizzo gli ultimi dati disponibili
        </div>
      )}

      <section className="question">
        <span>Cosa devo sapere oggi?</span>
        <strong>
          {loading
            ? "Aggiornamento…"
            : day
              ? "Programma disponibile"
              : "Il viaggio inizia il 21 agosto"}
        </strong>
      </section>

      {loading && (
        <div className="grid home-loading-grid">
          <div className="skeleton skeleton-wide" />
          <div className="skeleton" />
          <div className="skeleton" />
        </div>
      )}

      <div className="home-flow">
        <section className="home-section home-section-now">
          <div className="home-section-heading">
            <small>ADESSO</small>
            <h2>La prossima cosa da fare</h2>
          </div>

          <div className="home-now-grid">
            <LocationNavigation
              day={day || null}
              days={trip.days}
              simulation={simulation}
              onSimulationChange={setSimulation}
              showNextCard={false}
              onPositionChange={(position) => {
                if (!simulation.enabled) {
                  setMapPosition(position);
                  return;
                }

                if (!position) {
                  setSimulatedPosition(null);
                  return;
                }

                const isSimulatedSelection =
                  selectableSimulatedPositions.some(
                    (candidate) =>
                      Math.abs(
                        candidate.lat - position.lat,
                      ) < 0.000001 &&
                      Math.abs(
                        candidate.lon - position.lon,
                      ) < 0.000001,
                  );

                if (isSimulatedSelection) {
                  setSimulatedPosition({
                    date: simulation.date,
                    coordinates: position,
                  });
                } else {
                  setMapPosition(position);
                }
              }}
            />

            {stop && (
  <article className="next-stop-feature">
    <div className="next-stop-main">
      <small>PROSSIMA TAPPA</small>

      <h2>{stop.name}</h2>

      <p>{stop.city}</p>

      <div className="next-stop-route-options">
        {nextStopRoutesLoading && !nextStopRoutes ? (
          <small className="next-stop-route-loading">
            Calcolo percorsi…
          </small>
        ) : nextStopRoutes ? (
          <>
            <a
  className="next-stop-route-mode"
  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    mapsDestination(stop),
  )}&travelmode=driving`}
  target="_blank"
  rel="noreferrer"
>
  <span>🚗</span>

  <div>
    <small>AUTO</small>
    <strong>
      {formatRouteDuration(
        nextStopRoutes.car.durationMinutes,
      )}
    </strong>
    <em>
      {formatRouteDistance(
        nextStopRoutes.car.distanceKm,
      )}
    </em>
  </div>
</a>

            <a
  className="next-stop-route-mode"
  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    mapsDestination(stop),
  )}&travelmode=walking`}
  target="_blank"
  rel="noreferrer"
>
  <span>🚶</span>

  <div>
    <small>A PIEDI</small>
    <strong>
      {formatRouteDuration(
        nextStopRoutes.walk.durationMinutes,
      )}
    </strong>
    <em>
      {formatRouteDistance(
        nextStopRoutes.walk.distanceKm,
      )}
    </em>
  </div>
</a>

            <a
  className="next-stop-route-mode"
  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    mapsDestination(stop),
  )}&travelmode=transit`}
  target="_blank"
  rel="noreferrer"
>
  <span>🚌</span>

  <div>
    <small>MEZZI</small>

    {nextStopRoutes.transit.available ? (
      <>
        <strong>
          {formatRouteDuration(
            nextStopRoutes.transit.durationMinutes,
          )}
        </strong>

        <em>
          {formatRouteDistance(
            nextStopRoutes.transit.distanceKm,
          )}
        </em>
      </>
    ) : (
      <strong>—</strong>
    )}
  </div>
</a>
          </>
        ) : (
          <small className="next-stop-route-loading">
            Percorso non disponibile
          </small>
        )}
      </div>
    </div>

    <a
      href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        mapsDestination(stop),
      )}`}
      target="_blank"
      rel="noreferrer"
    >
      Naviga →
    </a>
  </article>
)}
          </div>
        </section>

        <section className="home-section home-section-mobility">
          <div className="home-section-heading">
            <small>MUOVERSI</small>
            <h2>Mappa e prossima tratta</h2>
          </div>

          <div className="home-mobility-grid">
            <OperationalMap
              day={day || homeDay || null}
              days={trip.days}
              currentPosition={
                simulation.enabled
                  ? effectiveLivePosition
                  : mapPosition
              }
              nextLeg={live?.nextTripLeg || null}
              route={live?.routing || null}
              onPositionChange={setMapPosition}
            />

            <article className="card route-card">
              <div className="card-head">
                <span>🚗 PROSSIMA TRATTA</span>
                <State
                  data={
                    live?.routing || {
                      dataState: "UNAVAILABLE",
                    }
                  }
                />
              </div>

              {live?.nextTripLeg ? (
                <>
                  <h2>
                    {live.nextTripLeg.origin} →{" "}
                    {live.nextTripLeg.destination}
                  </h2>

                  <p>
                    {live.routing.distanceKm
                      ? `${live.routing.distanceKm} km · ${live.routing.durationMinutes} min`
                      : "Stima del percorso non disponibile"}
                  </p>

                  <p>
                    Partenza prevista:{" "}
                    {live.nextTripLeg.plannedDeparture ||
                      "non configurata"}
                  </p>

                  {live.nextTripLeg.googleMapsUrl && (
                    <a
                      className="maps-button"
                      href={live.nextTripLeg.googleMapsUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      APRI IN GOOGLE MAPS
                    </a>
                  )}

                  <p className="muted">
                    {live.traffic.dataState ===
                    "NOT_CONFIGURED"
                      ? "Tempo stimato senza traffico live"
                      : getUserFacingProviderStatus(
                          live.traffic.dataState,
                          live.traffic.updatedAt,
                        ).label}
                  </p>
                </>
              ) : (
                <Empty text="Nessuna tratta pianificata" />
              )}
            </article>
          </div>
        </section>

        <section className="home-section home-section-context">
          <div className="home-section-heading">
            <small>OGGI A {recommendationLocation.toUpperCase()}</small>
            <h2>Informazioni utili</h2>
          </div>

          <div className="home-context-grid">
            {live ? (
              <Weather
                data={live.weather}
                location={live.weatherLocation}
              />
            ) : (
              <article className="card weather">
                <div className="card-head">
                  <span>
                    METEO · {recommendationLocation}
                  </span>
                </div>
                <Empty
                  text={
                    loading
                      ? "Aggiornamento meteo…"
                      : "Meteo non disponibile"
                  }
                />
              </article>
            )}

            <article className="home-guide-card">
              <small>GUIDA LOCALE</small>
              <h2>Scopri {recommendationLocation}</h2>
              <p>
                {homeDay
                  ? `${
                      homeDay.stops?.length ||
                      homeDay.pointsOfInterest.length
                    } luoghi del tuo itinerario, disponibili anche offline.`
                  : "Scopri i luoghi del viaggio, disponibili anche offline."}
              </p>
              <button
                onClick={() =>
                  onGuide(recommendationLocation)
                }
              >
                Apri guida →
              </button>
            </article>
          </div>
        </section>

        <section className="home-section home-section-discovery">
          <div className="home-section-heading">
            <small>SCOPRI NEI DINTORNI</small>
            <h2>{recommendationLocation}</h2>
          </div>

          <div className="home-discovery-grid">
            <FoodRecommendations
              location={recommendationLocation}
              position={discoveryPosition}
            />

            <OptionalStops
              location={recommendationLocation}
              dayNumber={Number(
                context.dayNumber || homeDay?.dayNumber || 0,
              )}
              position={discoveryPosition}
            />
          </div>

          <div className="home-restaurants-block">
            <RestaurantCarousel
              location={recommendationLocation}
              coordinates={realPosition}
/>
          </div>
        </section>

        {(kind === "sea" || kind === "boat_trip") && (
          <section className="home-section home-section-contextual">
            <div className="home-section-heading">
              <small>CONDIZIONI SPECIALI</small>
              <h2>Informazioni per la giornata</h2>
            </div>

            <article className="card contextual-card marine-card">
              <div className="card-head">
                <span>🌊 CONDIZIONI MARE</span>
                <State
                  data={
                    live?.sea || {
                      dataState: "UNAVAILABLE",
                    }
                  }
                />
              </div>

              <Empty
                text={
                  live?.sea.message ||
                  "Apri il dettaglio per onde e temperatura"
                }
              />

              <Fresh
                data={
                  live?.sea || {
                    dataState: "UNAVAILABLE",
                  }
                }
              />
            </article>
          </section>
        )}

        {kind === "etna" && (
          <section className="home-section home-section-contextual">
            <div className="home-section-heading">
              <small>CONDIZIONI SPECIALI</small>
              <h2>Etna live</h2>
            </div>

            <article className="card contextual-card etna-card">
              <div className="card-head">
                <span>🌋 ETNA LIVE</span>
                <State
                  data={
                    live?.etna || {
                      dataState: "UNAVAILABLE",
                    }
                  }
                />
              </div>

              {live?.etna.title ? (
                <>
                  <h2>{live.etna.title}</h2>
                  <p>{live.etna.summary}</p>

                  {live.etna.sourceUrl && (
                    <a
                      href={live.etna.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Apri fonte INGV
                    </a>
                  )}
                </>
              ) : (
                <Empty
                  text={
                    live?.etna.message ||
                    "Dato INGV non disponibile"
                  }
                />
              )}

              <Fresh
                data={
                  live?.etna || {
                    dataState: "UNAVAILABLE",
                  }
                }
              />
            </article>
          </section>
        )}

        <section className="home-section home-section-status">
          <div className="home-section-heading">
            <small>STATO DEL VIAGGIO</small>
            <h2>Tutto sotto controllo</h2>
          </div>

          <article className="card travel-status-card">
            <div className="card-head">
              <span>🚨 SITUAZIONE VIAGGIO</span>
              <span
                className={`state ${
                  situation === "ATTENZIONE"
                    ? "warning"
                    : situation === "OK"
                      ? "ok"
                      : "check"
                }`}
              >
                {situation === "OK"
                  ? "Tutto ok"
                  : situation === "ATTENZIONE"
                    ? "Attenzione"
                    : "Da controllare"}
              </span>
            </div>

            {live?.alerts.length ? (
              live.alerts.map((alert, index) => (
                <div
                  className="alert-row"
                  key={index}
                >
                  <strong>{alert.title}</strong>
                  <p>{alert.description}</p>
                </div>
              ))
            ) : (
              <div className="service-summary">
                <strong>
                  {live?.alertCoverageState === "FULL"
                    ? "🟢 Tutto tranquillo"
                    : "🟡 Da controllare"}
                </strong>

                <p>
                  {live?.alertCoverageState === "PARTIAL"
                    ? "Alcuni servizi non sono ancora disponibili."
                    : "Nessuna criticità rilevata dai servizi attivi."}
                </p>

                {relevantServices.map(([name, data]) => {
                  const status =
                    getUserFacingProviderStatus(
                      data?.dataState,
                      data?.updatedAt,
                    );

                  return (
                    <div
                      className="service-row"
                      key={name}
                    >
                      <span>{name}</span>
                      <strong className={status.tone}>
                        {status.label}
                      </strong>
                    </div>
                  );
                })}

                <details>
                  <summary>Stato servizi</summary>
                  <p>
                    Traffico ·{" "}
                    {
                      getUserFacingProviderStatus(
                        live?.traffic.dataState,
                      ).label
                    }
                  </p>
                  <p>
                    NEWS ·{" "}
                    {live?.newsLocation ||
                      "Posizione non disponibile"}{" "}
                    · Non disponibili
                  </p>
                </details>
              </div>
            )}
          </article>
        </section>
      </div>
    </main>
  );
}

function TripView({ trip, onChanged }: { trip: Trip; onChanged: () => void }) {
  const [selected, setSelected] = useState(
    trip.days.find((d) => d.date === trip.context.today) || trip.days[0],
  );
  const [show, setShow] = useState(false);
  async function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await api(`/api/trip/${selected.id}/activities`, {
      method: "POST",
      body: JSON.stringify({
        title: f.get("title"),
        location: f.get("location") || null,
        start_time: f.get("time") || null,
        activity_type: f.get("type") || "city",
        status: "planned",
        sort_order: selected.activities.length,
      }),
    });
    setShow(false);
    onChanged();
  }
  async function setStatus(id: number, status: string) {
    await api(`/api/activities/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    });
    onChanged();
  }
  return (
    <main>
      <header className="page-head">
        <div>
          <p className="eyebrow">IL TUO VIAGGIO</p>
          <h1>15 giorni in Sicilia</h1>
        </div>
      </header>
      <div className="timeline" role="tablist">
        {trip.days.map((d) => (
          <button
            className={d.id === selected.id ? "active" : ""}
            onClick={() => setSelected(d)}
            key={d.id}
          >
            <small>DAY {d.dayNumber}</small>
            <strong>{new Date(`${d.date}T12:00`).getDate()}</strong>
            <span>{short[new Date(`${d.date}T12:00`).getMonth()]}</span>
          </button>
        ))}
      </div>
      <section className="day-detail">
        <div>
          <p className="eyebrow">
            DAY {selected.dayNumber} · {fmt(selected.date)}
          </p>
          <h2>
            {selected.title || selected.baseCity || "Programma da completare"}
          </h2>
        </div>
        <button className="primary" onClick={() => setShow(true)}>
          + Attività
        </button>
      </section>
      <div className="activities">
        {selected.activities.length ? (
          selected.activities.map((a) => (
            <article className="activity" key={a.id}>
              <time>{a.startTime || "—:—"}</time>
              <div>
                <h3>{a.title}</h3>
                <p>
                  {a.location || "Luogo non impostato"} · {a.activityType}
                </p>
                <div className="quick-actions">
                  <button onClick={() => setStatus(a.id, "completed")}>
                    ✓ Fatto
                  </button>
                  <button onClick={() => setStatus(a.id, "skipped")}>
                    Salta
                  </button>
                </div>
              </div>
              <span className={`state ${a.status}`}>{a.status}</span>
            </article>
          ))
        ) : (
          <Empty text="Nessuna attività assegnata a questa giornata nel PDF." />
        )}
      </div>
      {show && (
        <div className="modal" onClick={() => setShow(false)}>
          <form onSubmit={add} onClick={(e) => e.stopPropagation()}>
            <div className="card-head">
              <h2>Nuova attività</h2>
              <button
                type="button"
                className="close"
                onClick={() => setShow(false)}
              >
                ×
              </button>
            </div>
            <label>
              Nome
              <input name="title" required autoFocus />
            </label>
            <label>
              Luogo
              <input name="location" />
            </label>
            <div className="form-row">
              <label>
                Ora
                <input name="time" type="time" />
              </label>
              <label>
                Tipo
                <select name="type">
                  <option value="city">Città</option>
                  <option value="road_trip">Road trip</option>
                  <option value="hiking">Trekking</option>
                  <option value="etna">Etna</option>
                  <option value="sea">Mare</option>
                  <option value="boat_trip">Boat tour</option>
                  <option value="archaeology">Archeologia</option>
                </select>
              </label>
            </div>
            <button className="primary wide">Salva attività</button>
          </form>
        </div>
      )}
    </main>
  );
}

function MapView({ trip }: { trip: Trip }) {
  const [mode, setMode] = useState<"today" | "all">("all");
  const [routes, setRoutes] = useState<Array<{ routing: RouteLive }>>([]);
  const[selectedPoint,setSelectedPoint]=useState<{name:string;lat:number;lon:number;day:number;category:string}|null>(null);
  const days =
    mode === "today"
      ? trip.days.filter((d) => d.date === trip.context.today)
      : trip.days;
  const points = useMemo(
    () =>
      days.flatMap((d) => {
        const p: Array<{
          name: string;
          lat: number;
          lon: number;
          day: number;
          category: string;
        }> = [];
        if (d.coordinates)
          p.push({
            name: d.baseCity || d.title || `Day ${d.dayNumber}`,
            lat: d.coordinates.lat,
            lon: d.coordinates.lon,
            day: d.dayNumber,
            category: "città",
          });
        d.activities.forEach(
          (a) =>
            a.coordinates &&
            p.push({
              name: a.title,
              lat: a.coordinates.lat,
              lon: a.coordinates.lon,
              day: d.dayNumber,
              category: a.activityType,
            }),
        );
        (d.stops||[]).forEach(
          (x) =>
            x.coordinates &&
            p.push({
              name: x.name,
              lat: x.coordinates.lat,
              lon: x.coordinates.lon,
              day: d.dayNumber,
              category: x.itemType || "poi",
            }),
        );
        return p;
      }),
    [days],
  );
  useEffect(() => {
    Promise.all(
      days
        .filter((d) => d.routes.length)
        .map((d) => api<Array<{ routing: RouteLive }>>(`/api/routes/${d.id}`)),
    )
      .then((x) => setRoutes(x.flat()))
      .catch(() => setRoutes([]));
  }, [mode, trip]);
  return (
    <main className="map-page">
      <header className="page-head map-title">
        <div>
          <p className="eyebrow">ESPLORA</p>
          <h1>Mappa del viaggio</h1>
        </div>
        <div className="segmented">
          <button
            className={mode === "today" ? "active" : ""}
            onClick={() => setMode("today")}
          >
            Oggi
          </button>
          <button
            className={mode === "all" ? "active" : ""}
            onClick={() => setMode("all")}
          >
            Intero viaggio
          </button>
        </div>
      </header>
      <div className="map-wrap">
        <MapContainer center={[37.6, 14.0]} zoom={8} scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {routes.map(
            (x, i) =>
              x.routing.geometry && (
                <Polyline
                  key={i}
                  positions={x.routing.geometry.coordinates.map((c) => [
                    c[1],
                    c[0],
                  ])}
                  pathOptions={{ color: "#df7139", weight: 4 }}
                />
              ),
          )}
          {points.map((p, i) => (
            <Marker key={i} position={[p.lat, p.lon]} icon={marker} eventHandlers={{click:()=>setSelectedPoint(p)}}>
              <Popup>
                <strong>{p.name}</strong>
                <br />
                Day {p.day} · {p.category}
                <br />
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}`}
                  target="_blank"
                >
                  Google Maps
                </a>{" "}
                ·{" "}
                <a
                  href={`https://maps.apple.com/?daddr=${p.lat},${p.lon}`}
                  target="_blank"
                >
                  Apple Maps
                </a>
              </Popup>
            </Marker>
          ))}
        </MapContainer>
        {!points.length && (
          <div className="map-empty">Nessuna tappa per questa modalità.</div>
        )}
      </div>
      <BottomSheet open={!!selectedPoint} title={selectedPoint?.name||''} onClose={()=>setSelectedPoint(null)}>{selectedPoint&&<><p className="sheet-location">Day {selectedPoint.day} · {selectedPoint.category}</p><div className="sheet-primary-actions"><a className="pip-primary" href={`https://www.google.com/maps/dir/?api=1&destination=${selectedPoint.lat},${selectedPoint.lon}`} target="_blank" rel="noreferrer">Naviga →</a><button className="pip-secondary" onClick={()=>setSelectedPoint(null)}>Torna alla mappa</button></div></>}</BottomSheet>
    </main>
  );
}

function Placeholder({ kind }: { kind: "alerts" | "more" }) {
  return (
    <main>
      <header className="page-head">
        <div>
          <p className="eyebrow">
            {kind === "alerts" ? "SITUAZIONE LIVE" : "STRUMENTI"}
          </p>
          <h1>{kind === "alerts" ? "Alert e aggiornamenti" : "Altro"}</h1>
        </div>
      </header>
      <div className="grid">
        {(kind === "alerts"
          ? [
              "Alert contestuali",
              "Notizie di viaggio",
              "Etna e aeroporti",
              "Trasporti e traghetti",
            ]
          : ["Meteo", "Luoghi salvati", "Quick info", "Impostazioni provider"]
        ).map((x) => (
          <article className="card" key={x}>
            <h2>{x}</h2>
            <p>
              Il modulo mostra “non disponibile” finché una fonte verificata non
              restituisce dati.
            </p>
          </article>
        ))}
      </div>
    </main>
  );
}

export default function App() {
  const [trip, setTrip] = useState<Trip | null>(null);
  const [view, setView] = useState<View>("today");
  const [tick, setTick] = useState(0);
  const [error, setError] = useState("");
  const [guideTarget,setGuideTarget]=useState("");
  const load = () =>
    api<Trip>("/api/trip")
      .then(setTrip)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    const f = () => setTick((x) => x + 1);
    window.addEventListener("online", f);
    window.addEventListener("offline", f);
    return () => {
      window.removeEventListener("online", f);
      window.removeEventListener("offline", f);
    };
  }, []);
  if (error)
    return (
      <div className="fatal">
        <h1>Dashboard non raggiungibile</h1>
        <p>{error}</p>
        <button onClick={load}>Riprova</button>
      </div>
    );
  if (!trip)
    return (
      <div className="splash">
        <img className="splash-logo" src="/pwa-icon-192.png" alt=""/>
        <p>Pip &amp; Pip Travelers</p>
      </div>
    );
  const changed = () => {
    void load();
  };
  return (
    <div className="app">
      {view === "today" && (
        <Today
          trip={trip}
          refreshToken={tick}
          onRefresh={() => setTick((x) => x + 1)}
          onGuide={name=>{setGuideTarget(name);setView("guide")}}
        />
      )}{" "}
      {view === "trip" && <ModernTripView trip={trip} onChanged={changed} onGuide={name=>{setGuideTarget(name);setView("guide")}} />}{" "}
      {view === "map" && <MapView trip={trip} />}{" "}
      {view === "guide" && <GuideView trip={trip} initial={guideTarget} onChanged={changed}/>} {" "}
      {view === "alerts" && <Placeholder kind="alerts" />}{" "}
      {view === "more" && <Placeholder kind="more" />}
      <nav>
        {(
          [
            ["today", "⌂", "Home"],
            ["trip", "◫", "Viaggio"],
            ["map", "⌖", "Mappa"],
            ["guide", "◇", "Guida"],
          ] as const
        ).map(([id, icon, label]) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            onClick={() => setView(id)}
          >
            <span>{icon}</span>
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
