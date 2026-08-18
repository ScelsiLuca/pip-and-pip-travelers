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
const nearestTripLocation=(trip:Trip,position:Coordinates)=>{const places=trip.days.flatMap(day=>[
  ...(day.stops||[]).filter(stop=>stop.coordinates).map(stop=>({name:stop.city,coordinates:stop.coordinates!})),
  ...(day.coordinates?[{name:day.baseCity||day.title||"Sicilia",coordinates:day.coordinates}]:[]),
]);return places.reduce<{name:string;distance:number}|null>((best,place)=>{const distance=distanceKm(position,place.coordinates);return !best||distance<best.distance?{name:place.name,distance}:best},null)?.name||"Posizione attuale"};
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
        <span>METEO</span>
        <State data={data} />
      </div>
      {location&&<small className="live-location">Posizione usata: {location}</small>}
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
function Today({
  trip,
  refreshToken,
  onRefresh,
  onGuide,
}: {
  trip: Trip;
  refreshToken: number;
  onRefresh: () => void;
  onGuide:(name:string)=>void;
}) {
  const [live, setLive] = useState<Dashboard | null>(null),
    [loading, setLoading] = useState(true);
  const [simulation, setSimulation] = useState({
    enabled: false,
    date: "2026-08-21",
  });
  const[mapPosition,setMapPosition]=useState<Coordinates|null>(null);
  const[realPosition,setRealPosition]=useState<DevicePosition|null>(null);
  const latestRealPosition=useRef<DevicePosition|null>(null);
  const acceptRealPosition=(next:DevicePosition)=>{const previous=latestRealPosition.current;if(previous&&distanceKm(previous,next)<1)return;latestRealPosition.current=next;setRealPosition(next);setMapPosition(next)};
  useEffect(()=>{let active=true,watch:{remove:()=>Promise<void>}|null=null;platformService.currentPosition().then(position=>{if(active)acceptRealPosition(position)}).catch(()=>{});platformService.watchPosition(position=>{if(active)acceptRealPosition(position)}).then(value=>watch=value).catch(()=>{});return()=>{active=false;void watch?.remove()}},[]);
  const realLocation=useMemo(()=>realPosition?nearestTripLocation(trip,realPosition):null,[trip,realPosition?.lat,realPosition?.lon]);
  const effectiveDate = simulation.enabled
    ? simulation.date
    : trip.context.today;
  useEffect(() => {
    setLoading(true);
    const params=new URLSearchParams({date:effectiveDate});
    if(realPosition){params.set('latitude',String(realPosition.lat));params.set('longitude',String(realPosition.lon));if(realLocation)params.set('location',realLocation)}
    api<Dashboard>(`/api/dashboard/today?${params}`)
      .then(setLive)
      .finally(() => setLoading(false));
  }, [refreshToken, effectiveDate, realPosition?.lat, realPosition?.lon, realLocation]);
  const day = live?.day,
    context = live?.context || trip.context,
    kind = day?.activityType || "city";
  const order =
    kind === "etna"
      ? { etna: 1, weather: 2, alerts: 3, route: 5 }
      : kind === "boat_trip" || kind === "sea"
        ? { sea: 1, weather: 2, alerts: 4, route: 6 }
        : kind === "road_trip"
          ? { route: 1, weather: 4, alerts: 3, etna: 6 }
          : { weather: 2, alerts: 4, route: 5, etna: 6 };
  const dayNumber = Number(context.dayNumber || 0),
    remainingDays = Number(context.remainingDays || 0),
    phase = String(context.phase || "before"),
    progress = dayNumber ? Math.round((dayNumber / 15) * 100) : 0;
  const situation=travelStatus(live?.alerts||[],live?.alertCoverageState||'PARTIAL');
  const primaryLocation=String((context as Record<string,unknown>).primaryLocation||day?.baseCity||day?.title||'Sicilia');
  const relevantServices:Array<[string,LiveData|undefined]>=[['Meteo',live?.weather]];
  if(kind==='etna')relevantServices.push(['Etna',live?.etna]);
  if(kind==='sea'||kind==='boat_trip')relevantServices.push(['Mare',live?.sea]);
  const stop=day?nextStop(day):null;
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
          <p className="sub">Il nostro viaggio in Sicilia</p>
          {dayNumber>0&&<p className="hero-location">{primaryLocation} · Sicilia</p>}
          {dayNumber > 0 && (
            <div className="progress">
              <span style={{ width: `${progress}%` }} />
              <small>
                {progress}% temporale · {remainingDays} giorni rimanenti
              </small>
            </div>
          )}
        </div>
        <button className="refresh" onClick={onRefresh} aria-label="Aggiorna">
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
      <div className="grid">
        {loading&&<><div className="skeleton skeleton-wide"/><div className="skeleton"/><div className="skeleton"/></>}
        <LocationNavigation
          day={day || null}
          days={trip.days}
          simulation={simulation}
          onSimulationChange={setSimulation}
          onPositionChange={setMapPosition}
        />
        {stop&&<article className="next-stop-feature"><div><small>PROSSIMA TAPPA</small><h2>{stop.name}</h2><p>{stop.city}</p></div><a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(mapsDestination(stop))}`} target="_blank" rel="noreferrer">Naviga →</a></article>}
        <OperationalMap day={day||null} days={trip.days} currentPosition={mapPosition} nextLeg={live?.nextTripLeg||null} route={live?.routing||null} onPositionChange={setMapPosition}/>
        {live && (
          <div style={{ display: "contents", order: order.weather }}>
            <Weather data={live.weather} location={live.weatherLocation} />
          </div>
        )}
        {day&&<article className="home-guide-card"><small>GUIDA LOCALE</small><h2>Scopri {primaryLocation.split(',')[0]}</h2><p>{day.stops?.length||day.pointsOfInterest.length} luoghi del tuo itinerario, disponibili anche offline.</p><button onClick={()=>onGuide(primaryLocation)}>Apri guida →</button></article>}
        {day&&<RestaurantCarousel location={primaryLocation.split(',')[0]} coordinates={day.coordinates}/>} 
        {(kind === "sea" || kind === "boat_trip") && (
          <article className="card contextual-card marine-card" style={{ order: order.sea }}>
            <div className="card-head">
              <span>🌊 CONDIZIONI MARE</span>
              <State data={live?.sea || { dataState: "UNAVAILABLE" }} />
            </div>
            <Empty
              text={
                live?.sea.message || "Apri il dettaglio per onde e temperatura"
              }
            />
            <Fresh data={live?.sea || { dataState: "UNAVAILABLE" }} />
          </article>
        )}
        <article className="card route-card" style={{ order: order.route }}>
          <div className="card-head">
            <span>🚗 PROSSIMA TRATTA</span>
            <State data={live?.routing || { dataState: "UNAVAILABLE" }} />
          </div>
          {live?.nextTripLeg ? (
            <>
              <h2>
                {live.nextTripLeg.origin} → {live.nextTripLeg.destination}
              </h2>
              <p>
                {live?.routing.distanceKm
                  ? `${live.routing.distanceKm} km · ${live.routing.durationMinutes} min`
                  : "Stima del percorso non disponibile"}
              </p>
              <p>Partenza prevista: {live.nextTripLeg.plannedDeparture||'non configurata'}</p>
              {live.nextTripLeg.googleMapsUrl&&<a className="maps-button" href={live.nextTripLeg.googleMapsUrl} target="_blank" rel="noreferrer">APRI IN GOOGLE MAPS</a>}
              <p className="muted">{live?.traffic.dataState === "NOT_CONFIGURED"?"Tempo stimato senza traffico live":getUserFacingProviderStatus(live?.traffic.dataState,live?.traffic.updatedAt).label}</p>
            </>
          ) : (
            <Empty text="Nessuna tratta pianificata" />
          )}
        </article>
        <article className="card travel-status-card" style={{ order: order.alerts }}>
          <div className="card-head">
            <span>🚨 SITUAZIONE VIAGGIO</span>
            <span className={`state ${situation==='ATTENZIONE'?'warning':situation==='OK'?'ok':'check'}`}>{situation==='OK'?'Tutto ok':situation==='ATTENZIONE'?'Attenzione':'Da controllare'}</span>
          </div>
          {live?.alerts.length ? (
            live.alerts.map((a, i) => (
              <div className="alert-row" key={i}>
                <strong>{a.title}</strong>
                <p>{a.description}</p>
              </div>
            ))
          ) : (
            <div className="service-summary"><strong>{live?.alertCoverageState==='FULL'?'🟢 Tutto tranquillo':'🟡 Da controllare'}</strong><p>{live?.alertCoverageState==='PARTIAL'?'Alcuni servizi non sono ancora disponibili.':'Nessuna criticità rilevata dai servizi attivi.'}</p>{relevantServices.map(([name,data])=>{const s=getUserFacingProviderStatus(data?.dataState,data?.updatedAt);return <div className="service-row" key={name}><span>{name}</span><strong className={s.tone}>{s.label}</strong></div>})}<details><summary>Stato servizi</summary><p>Traffico · {getUserFacingProviderStatus(live?.traffic.dataState).label}</p><p>Notizie per {live?.newsLocation||primaryLocation} · Non disponibili</p></details></div>
          )}
        </article>
        {kind === "etna" && (
          <article className="card contextual-card etna-card" style={{ order: order.etna }}>
            <div className="card-head">
              <span>🌋 ETNA LIVE</span>
              <State data={live?.etna || { dataState: "UNAVAILABLE" }} />
            </div>
            {live?.etna.title ? (
              <>
                <h2>{live.etna.title}</h2>
                <p>{live.etna.summary}</p>
                {live.etna.sourceUrl && (
                  <a href={live.etna.sourceUrl} target="_blank">
                    Apri fonte INGV
                  </a>
                )}
              </>
            ) : (
              <Empty text={live?.etna.message || "Dato INGV non disponibile"} />
            )}
            <Fresh data={live?.etna || { dataState: "UNAVAILABLE" }} />
          </article>
        )}
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
