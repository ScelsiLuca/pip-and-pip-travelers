import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type { Coordinates, RouteLive, TripDay } from "./types";
import {
  platformService,
  type DevicePosition,
} from "./services/platformService";
import { BottomSheet, Toast } from "./TravelExperience";

export type SimulationContext = {
  enabled: boolean;
  date: string;
  mode: "day" | "stop";
  stopId: number | null;
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
};

type SimulationStop = {
  id: number;
  name: string;
  city: string;
  date: string;
  dayNumber: number;
  startTime: string | null;
  sortOrder: number;
};

function simulationLabel(date: string) {
  return new Date(`${date}T12:00`).toLocaleDateString("it-IT", {
    day: "numeric",
    month: "short",
  }).toUpperCase();
}

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
  const [position, setPosition] = useState<DevicePosition | null>(null);
  const [navigation, setNavigation] = useState<Navigation | null>(null);
  const [sheet, setSheet] = useState(false);
  const [toast, setToast] = useState("");

  const simulationStops = useMemo<SimulationStop[]>(
    () =>
      days.flatMap((tripDay) =>
        (tripDay.stops || []).map((stop) => ({
          id: stop.id,
          name: stop.name,
          city: stop.city || tripDay.baseCity || "",
          date: tripDay.date,
          dayNumber: tripDay.dayNumber,
          startTime: stop.startTime || null,
          sortOrder: stop.sortOrder || 0,
        })),
      ),
    [days],
  );

  const selectedStop =
    simulation.stopId != null
      ? simulationStops.find((stop) => stop.id === simulation.stopId) || null
      : null;

  const selectedSimulationDay =
    days.find((tripDay) => tripDay.date === simulation.date) || null;

  const stopsForSelectedDay = selectedSimulationDay
    ? simulationStops
        .filter(
          (stop) => stop.date === selectedSimulationDay.date,
        )
        .sort((a, b) => {
          if (a.startTime && b.startTime) {
            return a.startTime.localeCompare(b.startTime);
          }

          if (a.startTime && !b.startTime) {
            return -1;
          }

          if (!a.startTime && b.startTime) {
            return 1;
          }

          return a.sortOrder - b.sortOrder;
        })
    : [];

  const locate = async () => {
    try {
      const next = await platformService.currentPosition();
      setPosition(next);
      onPositionChange?.(next);
      setToast("Posizione aggiornata");
      setTimeout(() => setToast(""), 1800);
    } catch {
      setToast("GPS non disponibile");
      setTimeout(() => setToast(""), 1800);
    }
  };

  const selectMode = (mode: "day" | "stop") => {
    onSimulationChange({
      ...simulation,
      mode,
      stopId: mode === "day" ? null : simulation.stopId,
    });
  };

  const selectDate = (date: string) => {
    onSimulationChange({
      ...simulation,
      enabled: Boolean(date),
      mode: "day",
      date,
      stopId: null,
    });
  };

  const selectStopDay = (date: string) => {
    onSimulationChange({
      ...simulation,
      mode: "stop",
      date,
      stopId: null,
    });
  };

  const selectStop = (value: string) => {
    const id = Number(value);

    if (!Number.isFinite(id)) return;

    const stop = simulationStops.find((item) => item.id === id);

    if (!stop) return;

    onSimulationChange({
      ...simulation,
      enabled: true,
      mode: "stop",
      date: stop.date,
      stopId: stop.id,
    });
  };

  const resetSimulation = () => {
    onSimulationChange({
      enabled: false,
      mode: "day",
      date: "",
      stopId: null,
    });

    setNavigation(null);
  };

  useEffect(() => {
    const body: Record<string, unknown> = {};

    if (simulation.enabled) {
      body.simulation = true;
      body.simulation_date = simulation.date;
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
    simulation.enabled,
    simulation.date,
    simulation.stopId,
    position,
    day,
  ]);

  const route = navigation?.route;

  return (
    <section className="navigation-live modern-navigation">
      <button
        className={`simulation-pill ${simulation.enabled ? "active" : ""}`}
        onClick={() => setSheet(true)}
      >
        <span>◎</span>
        {simulation.enabled
          ? `SIMULAZIONE · ${simulationLabel(simulation.date)}`
          : "SIMULAZIONE"}
        <b>›</b>
      </button>

      {showNextCard && (
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
              ⌖{" "}
              {navigation.nextActivity.location ||
                "Località non impostata"}
            </p>

            {route?.distanceKm != null ? (
              Number(route.distanceKm) < 0.5 ? (
                <p className="already-here">Sei già qui</p>
              ) : (
                <div className="route-summary">
                  <strong>{route.distanceKm} km</strong>
                  <span>
                    {route.liveDurationMinutes ||
                      route.staticDurationMinutes ||
                      route.durationMinutes}{" "}
                    min
                  </span>
                </div>
              )
            ) : (
              <p className="muted">Stima in aggiornamento</p>
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
          <p>Nessuna prossima attività per questa giornata.</p>
        )}
      </article>
      )}

      <BottomSheet
        open={sheet}
        title="Simulazione"
        onClose={() => setSheet(false)}
      >
        <div className="simulation-sheet">


          <div className="choice-chips">
            <button
              className={simulation.mode === "day" ? "active" : ""}
              onClick={() => selectMode("day")}
            >
              Giorno
            </button>

            <button
              className={simulation.mode === "stop" ? "active" : ""}
              onClick={() => selectMode("stop")}
            >
              Tappa
            </button>
          </div>

          {simulation.mode === "day" && (
            <label className="modern-date">
              <span>Giorno simulato</span>
              <input
                type="date"
                min="2026-08-21"
                max="2026-09-04"
                value={simulation.date}
                onChange={(event) => selectDate(event.target.value)}
              />
            </label>
          )}

          {simulation.mode === "stop" && (
            <div className="simulation-stop-picker">
              <label className="modern-date">
                <span>Giorno</span>

                <div className="simulation-select-wrap">
                  <select
                    className="simulation-select"
                    value={simulation.date}
                    onChange={(event) =>
                      selectStopDay(event.target.value)
                    }
                  >
                    <option value="">Seleziona un giorno</option>

                    {days.map((tripDay) => (
                      <option
                        key={tripDay.id}
                        value={tripDay.date}
                      >
                        Day {tripDay.dayNumber} ·{" "}
                        {simulationLabel(tripDay.date)}
                        {tripDay.title
                          ? ` · ${tripDay.title}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
              </label>

              <label className="modern-date">
                <span>Tappa</span>

                <div className="simulation-select-wrap">
                  <select
                    className="simulation-select"
                    value={simulation.stopId ?? ""}
                    onChange={(event) =>
                      selectStop(event.target.value)
                    }
                  >
                    <option value="">
                      Seleziona una tappa
                    </option>

                    {stopsForSelectedDay.map((stop) => (
                      <option key={stop.id} value={stop.id}>
                        {stop.startTime
                          ? `${stop.startTime} | ${stop.name}${stop.city ? ` | ${stop.city}` : ""}`
                          : `--:-- | ${stop.name}${stop.city ? ` | ${stop.city}` : ""}`}
                      </option>
                    ))}
                  </select>
                </div>

                {selectedStop && (
                  <small className="simulation-selection-info">
                    Day {selectedStop.dayNumber}
                    {selectedStop.city
                      ? ` · ${selectedStop.city}`
                      : ""}
                  </small>
                )}
              </label>
            </div>
          )}

          <div className="simulation-actions">
            <button
              type="button"
              className="simulation-reset"
              onClick={resetSimulation}
            >
              <span>↺</span>
              Ripristina
            </button>

            <button
              className={`simulation-toggle ${
                simulation.enabled ? "active" : ""
              }`}
              disabled={
                !simulation.date ||
                (simulation.mode === "stop" &&
                  simulation.stopId == null)
              }
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
        </div>
      </BottomSheet>

      <Toast message={toast} />
    </section>
  );
}
