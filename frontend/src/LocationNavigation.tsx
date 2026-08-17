import { useEffect, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import { api } from "./api";
import type { Coordinates, RouteLive, TripDay } from "./types";
import {
  platformService,
  type DevicePosition,
} from "./services/platformService";

type Position = DevicePosition;
export type SimulationContext = { enabled: boolean; date: string };
type Navigation = {
  origin: ({ type: string } & Coordinates) | null;
  nextActivity: {
    title: string;
    location: string | null;
    activityType: string;
    coordinates: Coordinates | null;
  } | null;
  route: RouteLive & {
    staticDurationMinutes?: number;
    liveDurationMinutes?: number;
    trafficDelayMinutes?: number;
  };
  googleMapsUrl?: string | null;
  leaveNow?: { departureSuggested: string } | null;
};

export default function LocationNavigation({
  day,
  days,
  simulation,
  onSimulationChange,
  onPositionChange,
}: {
  day: TripDay | null;
  days: TripDay[];
  simulation: SimulationContext;
  onSimulationChange: (v: SimulationContext) => void;
  onPositionChange?: (position: Coordinates | null) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [position, setPosition] = useState<Position | null>(null),
    [permissionError, setPermissionError] = useState(""),
    [navigation, setNavigation] = useState<Navigation | null>(null);
  const [simKind, setSimKind] = useState<
      "planned" | "location" | "coordinates"
    >("planned"),
    [simLocation, setSimLocation] = useState(""),
    [simLat, setSimLat] = useState(""),
    [simLon, setSimLon] = useState("");
  const locations = days
    .flatMap((d) => {
      const v: { name: string; coordinates: Coordinates }[] = [];
      if (d.coordinates)
        v.push({
          name: d.baseCity || d.title || `Day ${d.dayNumber}`,
          coordinates: d.coordinates,
        });
      d.routes.forEach((r) => {
        if (r.originCoordinates)
          v.push({ name: r.origin, coordinates: r.originCoordinates });
        if (r.destinationCoordinates)
          v.push({
            name: r.destination,
            coordinates: r.destinationCoordinates,
          });
      });
      return v;
    })
    .filter((v, i, a) => a.findIndex((x) => x.name === v.name) === i);
  const selected = locations.find((x) => x.name === simLocation);
  const requestPosition = async () => {
    try {
      const next = await platformService.currentPosition();
      setPosition(next);
      setPermissionError("");
    } catch (error) {
      setPosition(null);
      const state = String((error as Error).message);
      setPermissionError(
        state === "PERMISSION_DENIED"
          ? "Permesso posizione negato"
          : state === "GPS_DISABLED"
            ? "GPS disattivato"
            : "Posizione non disponibile",
      );
    }
  };
  useEffect(() => {
    void platformService
      .getPreference("useCurrentLocation")
      .then((value) => setEnabled(value === "true"));
  }, []);
  useEffect(() => {
    void platformService.setPreference("useCurrentLocation", String(enabled));
    if (!enabled || simulation.enabled) {
      setPosition(null);
      return;
    }
    void requestPosition();
  }, [enabled, simulation.enabled]);
  useEffect(()=>onPositionChange?.(simulation.enabled?null:position),[position,simulation.enabled,onPositionChange]);
  useEffect(() => {
    const input =
      document.querySelector<HTMLInputElement>('input[type="date"]');
    if (!input) return;
    const update = () => {
      if (input.value) onSimulationChange({ ...simulation, date: input.value });
    };
    input.addEventListener("input", update);
    return () => input.removeEventListener("input", update);
  }, [simulation.enabled, simulation.date, onSimulationChange]);
  useEffect(() => {
    const body: Record<string, unknown> = {};
    if (simulation.enabled) {
      body.simulation = true;
      body.simulation_date = simulation.date;
      if (simKind === "location" && selected) {
        body.latitude = selected.coordinates.lat;
        body.longitude = selected.coordinates.lon;
      } else if (simKind === "coordinates" && simLat && simLon) {
        body.latitude = Number(simLat);
        body.longitude = Number(simLon);
      }
    } else if (position) {
      body.latitude = position.lat;
      body.longitude = position.lon;
    }
    api<Navigation>("/api/navigation/next", {
      method: "POST",
      body: JSON.stringify(body),
    })
      .then(setNavigation)
      .catch(() => setNavigation(null));
  }, [position, simulation, simKind, simLocation, simLat, simLon, day]);
  const origin = navigation?.origin,
    target = navigation?.nextActivity?.coordinates,
    route = navigation?.route;
  const center: [number, number] =
    origin && target
      ? [(origin.lat + target.lat) / 2, (origin.lon + target.lon) / 2]
      : target
        ? [target.lat, target.lon]
        : origin
          ? [origin.lat, origin.lon]
          : [37.6, 14];
  const gpsLive = !simulation.enabled && !!position && origin?.type === "GPS";
  useEffect(() => {
    const link = document.querySelector<HTMLAnchorElement>(".maps-button");
    if (!link || !target || !navigation?.googleMapsUrl) return;
    const open = (event: Event) => {
      event.preventDefault();
      void platformService.navigate(target, navigation.googleMapsUrl!);
    };
    link.addEventListener("click", open);
    return () => link.removeEventListener("click", open);
  }, [target?.lat, target?.lon, navigation?.googleMapsUrl]);
  return (
    <section className="navigation-live">
      {simulation.enabled && (
        <div className="simulation-banner">
          SIMULATION MODE · GPS reale disattivato
        </div>
      )}
      <div className="location-card">
        <div className="card-head">
          <span>📍 DOVE SEI</span>
          <span className={`state ${gpsLive ? "ok" : "check"}`}>
            {simulation.enabled
              ? "Simulazione"
              : gpsLive
                ? "Posizione aggiornata"
                : origin
                  ? "Posizione pianificata"
                  : "Posizione non disponibile"}
          </span>
        </div>
        {origin ? (
          <>
            <strong>
              {simKind === "location" && selected
                ? selected.name
                : `${origin.lat.toFixed(5)}, ${origin.lon.toFixed(5)}`}
            </strong>
            {gpsLive && position && (
              <small>Precisione ±{Math.round(position.accuracy)} m</small>
            )}
          </>
        ) : (
          <p>{permissionError || "Posizione pianificata non disponibile."}</p>
        )}
        <div className="location-controls">
          <label>
            <input
              type="checkbox"
              checked={enabled}
              disabled={simulation.enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />{" "}
            Usa posizione attuale
          </label>
          {enabled && !simulation.enabled && (
            <button onClick={requestPosition}>↻ Aggiorna posizione</button>
          )}
        </div>
        {permissionError && (
          <p className="location-warning">{permissionError}</p>
        )}
        <details open={simulation.enabled}>
          <summary>Simulazione</summary>
          <label>
            <input
              type="checkbox"
              checked={simulation.enabled}
              onChange={(e) =>
                onSimulationChange({ ...simulation, enabled: e.target.checked })
              }
            />{" "}
            Attiva
          </label>
          {simulation.enabled && (
            <div className="simulation-controls">
              <input
                type="date"
                min="2026-08-21"
                max="2026-09-04"
                value={simulation.date}
                onChange={(e) =>
                  onSimulationChange({ ...simulation, date: e.target.value })
                }
              />
              <select
                aria-label="Posizione simulata"
                value={simKind}
                onChange={(e) => setSimKind(e.target.value as typeof simKind)}
              >
                <option value="planned">Posizione pianificata</option>
                <option value="location">Località personalizzata</option>
                <option value="coordinates">Coordinate personalizzate</option>
              </select>
              {simKind === "location" && (
                <select
                  aria-label="Località simulata"
                  value={simLocation}
                  onChange={(e) => setSimLocation(e.target.value)}
                >
                  <option value="">Scegli una località</option>
                  {locations.map((x) => (
                    <option key={x.name}>{x.name}</option>
                  ))}
                </select>
              )}
              {simKind === "coordinates" && (
                <>
                  <input
                    aria-label="Latitudine simulata"
                    placeholder="Latitudine"
                    value={simLat}
                    onChange={(e) => setSimLat(e.target.value)}
                  />
                  <input
                    aria-label="Longitudine simulata"
                    placeholder="Longitudine"
                    value={simLon}
                    onChange={(e) => setSimLon(e.target.value)}
                  />
                </>
              )}
            </div>
          )}
        </details>
      </div>
      <article className="next-card">
        <div className="card-head">
          <span>PROSSIMA ATTIVITÀ</span>
          <span>
            {navigation?.nextActivity?.activityType?.toUpperCase() || "—"}
          </span>
        </div>
        {navigation?.nextActivity ? (
          <>
            <h2>{navigation.nextActivity.title}</h2>
            <p>
              📍 {navigation.nextActivity.location || "Località non impostata"}
            </p>
            {route?.distanceKm != null ? (
              Number(route.distanceKm)<0.5?<p className="already-here">Sei già qui</p>:<div className="route-summary"><strong>🚗 {route.distanceKm} km</strong><span>⏱ {route.liveDurationMinutes||route.staticDurationMinutes||route.durationMinutes} min</span></div>
            ) : (
              <p>Stima del percorso non disponibile</p>
            )}
            <p className="muted">
              {route?.trafficDelayMinutes != null
                ? `🚦 +${route.trafficDelayMinutes} min traffico`
                : "Tempo stimato senza traffico live"}
            </p>
            {navigation.googleMapsUrl && (
              <a
                className="maps-button"
                href={navigation.googleMapsUrl}
                target="_blank"
                rel="noreferrer"
              >
                APRI IN GOOGLE MAPS
              </a>
            )}
            {navigation.leaveNow ? (
              <div className="leave">
                <small>PARTENZA CONSIGLIATA</small>
                <strong>
                  {new Date(
                    navigation.leaveNow.departureSuggested,
                  ).toLocaleTimeString("it-IT", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </strong>
              </div>
            ) : (
              <small>
                Calcolo partenza non disponibile: orario attività non
                configurato.
              </small>
            )}
          </>
        ) : (
          <p>Nessuna prossima attività per questa giornata.</p>
        )}
      </article>
      {(origin || target) && (
        <div className="mini-map">
          <MapContainer
            key={`${origin?.lat}-${target?.lat}`}
            center={center}
            zoom={9}
            scrollWheelZoom={false}
            dragging
            touchZoom
            zoomControl
          >
            <TileLayer
              attribution="&copy; OpenStreetMap"
              url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            {route?.geometry && (
              <Polyline
                positions={route.geometry.coordinates.map((c) => [c[1], c[0]])}
              />
            )}{" "}
            {origin && (
              <CircleMarker center={[origin.lat, origin.lon]} radius={8}>
                <Popup>Posizione corrente</Popup>
              </CircleMarker>
            )}
            {target && (
              <CircleMarker center={[target.lat, target.lon]} radius={8}>
                <Popup>{navigation?.nextActivity?.title}</Popup>
              </CircleMarker>
            )}
          </MapContainer>
        </div>
      )}
    </section>
  );
}
