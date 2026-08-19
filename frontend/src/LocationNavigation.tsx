import { useEffect, useMemo, useState } from "react";

import { api } from "./api";
import type {
  Coordinates,
  RouteLive,
  TripDay,
} from "./types";
import {
  platformService,
  type DevicePosition,
} from "./services/platformService";
import {
  BottomSheet,
  Toast,
} from "./TravelExperience";

export type SimulationContext = {
  enabled: boolean;
  date: string;
};

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
  leaveNow?: {
    departureSuggested: string;
  } | null;
};

export default function LocationNavigation({
  day,
  days,
  simulation,
  onSimulationChange,
  onPositionChange,
  showNextCard = true,
}: {
  day: TripDay | null;
  days: TripDay[];
  simulation: SimulationContext;
  onSimulationChange: (value: SimulationContext) => void;
  onPositionChange?: (position: Coordinates | null) => void;
  showNextCard?: boolean;
}) {
  const [position, setPosition] =
    useState<DevicePosition | null>(null);
  const [navigation, setNavigation] =
    useState<Navigation | null>(null);
  const [sheet, setSheet] = useState(false);
  const [mode, setMode] =
    useState<"planned" | "location">("planned");
  const [place, setPlace] = useState("");
  const [toast, setToast] = useState("");

  const locations = useMemo(
    () =>
      days
        .flatMap((tripDay) => {
          const output: Array<{
            name: string;
            coordinates: Coordinates;
          }> = [];

          if (tripDay.coordinates) {
            output.push({
              name:
                tripDay.baseCity ||
                tripDay.title ||
                `Day ${tripDay.dayNumber}`,
              coordinates: tripDay.coordinates,
            });
          }

          tripDay.routes.forEach((route) => {
            if (route.originCoordinates) {
              output.push({
                name: route.origin,
                coordinates: route.originCoordinates,
              });
            }

            if (route.destinationCoordinates) {
              output.push({
                name: route.destination,
                coordinates: route.destinationCoordinates,
              });
            }
          });

          return output;
        })
        .filter(
          (value, index, all) =>
            all.findIndex(
              (item) => item.name === value.name,
            ) === index,
        ),
    [days],
  );

  const selected = locations.find(
    (item) => item.name === place,
  );

  const locate = async () => {
    try {
      const next =
        await platformService.currentPosition();

      setPosition(next);
      onPositionChange?.(next);

      setToast("Posizione aggiornata");
      window.setTimeout(
        () => setToast(""),
        1800,
      );
    } catch {
      setToast("GPS non disponibile");
      window.setTimeout(
        () => setToast(""),
        1800,
      );
    }
  };

  useEffect(() => {
    const body: Record<string, unknown> = {};

    if (simulation.enabled) {
      body.simulation = true;
      body.simulation_date = simulation.date;

      if (mode === "location" && selected) {
        body.latitude = selected.coordinates.lat;
        body.longitude = selected.coordinates.lon;
        onPositionChange?.(selected.coordinates);
      } else {
        onPositionChange?.(null);
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
  }, [
    simulation,
    mode,
    selected?.name,
    position,
    day,
  ]);

  const route = navigation?.route;

  return (
    <section className="navigation-live modern-navigation">
      <button
        className={`simulation-pill ${
          simulation.enabled ? "active" : ""
        }`}
        onClick={() => setSheet(true)}
      >
        <span>◎</span>

        {simulation.enabled
          ? `SIMULAZIONE · ${new Date(
              `${simulation.date}T12:00`,
            ).getDate()} AGO`
          : "POSIZIONE E SIMULAZIONE"}

        <b>›</b>
      </button>

      {showNextCard && (
        <article className="next-card">
          <div className="card-head">
            <span>PROSSIMA ATTIVITÀ</span>

            <span>
              {navigation?.nextActivity?.activityType?.toUpperCase() ||
                "—"}
            </span>
          </div>

          {navigation?.nextActivity ? (
            <>
              <h2>
                {navigation.nextActivity.title}
              </h2>

              <p>
                ⌖{" "}
                {navigation.nextActivity.location ||
                  "Località non impostata"}
              </p>

              {route?.distanceKm != null ? (
                Number(route.distanceKm) < 0.5 ? (
                  <p className="already-here">
                    Sei già qui
                  </p>
                ) : (
                  <div className="route-summary">
                    <strong>
                      {route.distanceKm} km
                    </strong>

                    <span>
                      {route.liveDurationMinutes ||
                        route.staticDurationMinutes ||
                        route.durationMinutes}{" "}
                      min
                    </span>
                  </div>
                )
              ) : (
                <p className="muted">
                  Stima in aggiornamento
                </p>
              )}

              {navigation.googleMapsUrl && (
                <a
                  className="maps-button"
                  href={navigation.googleMapsUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Naviga <span>→</span>
                </a>
              )}
            </>
          ) : (
            <p>
              Nessuna prossima attività per questa
              giornata.
            </p>
          )}
        </article>
      )}

      <BottomSheet
        open={sheet}
        title="Posizione e simulazione"
        onClose={() => setSheet(false)}
      >
        <div className="simulation-sheet">
          <button
            className="gps-action"
            onClick={locate}
          >
            <span>⌖</span>

            <div>
              <strong>
                Usa posizione attuale
              </strong>
              <small>
                La posizione non viene salvata
              </small>
            </div>

            <b>→</b>
          </button>

          <div className="sheet-divider">
            <span>OPPURE</span>
          </div>

          <label className="modern-date">
            <span>Data simulata</span>

            <input
              type="date"
              min="2026-08-21"
              max="2026-09-04"
              value={simulation.date}
              onChange={(event) =>
                onSimulationChange({
                  ...simulation,
                  date: event.target.value,
                })
              }
            />
          </label>

          <div className="choice-chips">
            <button
              className={
                mode === "planned"
                  ? "active"
                  : ""
              }
              onClick={() =>
                setMode("planned")
              }
            >
              Itinerario
            </button>

            <button
              className={
                mode === "location"
                  ? "active"
                  : ""
              }
              onClick={() =>
                setMode("location")
              }
            >
              Località
            </button>
          </div>

          {mode === "location" && (
            <div className="location-options">
              {locations.map((item) => (
                <button
                  className={
                    place === item.name
                      ? "active"
                      : ""
                  }
                  onClick={() =>
                    setPlace(item.name)
                  }
                  key={item.name}
                >
                  {item.name}
                </button>
              ))}
            </div>
          )}

          <button
            className={`simulation-toggle ${
              simulation.enabled ? "active" : ""
            }`}
            onClick={() =>
              onSimulationChange({
                ...simulation,
                enabled: !simulation.enabled,
              })
            }
          >
            {simulation.enabled
              ? "Disattiva simulazione"
              : "Attiva simulazione"}{" "}
            <span>→</span>
          </button>
        </div>
      </BottomSheet>

      <Toast message={toast} />
    </section>
  );
}
