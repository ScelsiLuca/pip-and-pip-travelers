import {
  APIProvider,
  AdvancedMarker,
  InfoWindow,
  Map,
  Pin,
  useMap,
} from "@vis.gl/react-google-maps";
import { useEffect, useMemo, useState } from "react";

import type {
  Coordinates,
  RouteLive,
  TripDay,
} from "./types";
import {
  platformService,
  type DevicePosition,
} from "./services/platformService";

export type TripLeg = {
  id: number | null;
  kind: string;
  dayId: number;
  origin: string;
  destination: string;
  originCoordinates: Coordinates | null;
  destinationCoordinates: Coordinates | null;
  originAddress?: string | null;
  destinationAddress?: string | null;
  plannedDeparture: string | null;
  googleMapsUrl?: string | null;
};

type Props = {
  day: TripDay | null;
  days: TripDay[];
  currentPosition: Coordinates | null;
  nextLeg: TripLeg | null;
  route: RouteLive | null;
  onPositionChange?: (
    position: Coordinates | null,
  ) => void;

  initialMode?: "today" | "trip";
  pageMode?: boolean;
};

type MapPoint = {
  lat: number;
  lng: number;
};

type ItineraryMapStop = {
  key: string;
  name: string;
  city: string;
  dayNumber: number;
  startTime?: string | null;
  coordinates: MapPoint;
};

type TripPath = {
  dayNumber: number;
  path: MapPoint[];
};

type InterdayTransferPath = {
  fromDay: number;
  toDay: number;
  originName: string;
  destinationName: string;
  path: [MapPoint, MapPoint];
};

function toGooglePoint(
  coordinates: Coordinates | null | undefined,
): MapPoint | null {
  if (!coordinates) return null;

  return {
    lat: coordinates.lat,
    lng: coordinates.lon,
  };
}

function boundsFor(
  points: MapPoint[],
): google.maps.LatLngBoundsLiteral | null {
  if (!points.length) return null;

  return {
    north: Math.max(...points.map((point) => point.lat)),
    south: Math.min(...points.map((point) => point.lat)),
    east: Math.max(...points.map((point) => point.lng)),
    west: Math.min(...points.map((point) => point.lng)),
  };
}

function MapViewport({
  points,
  locatePosition,
  locateToken,
}: {
  points: MapPoint[];
  locatePosition: DevicePosition | null;
  locateToken: number;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !points.length) return;

    if (points.length === 1) {
      map.setCenter(points[0]);
      map.setZoom(13);
      return;
    }

    const bounds = boundsFor(points);

    if (bounds) {
      map.fitBounds(bounds, 50);
    }
  }, [map, points]);

  useEffect(() => {
    if (!map || !locatePosition || !locateToken) {
      return;
    }

    map.panTo({
      lat: locatePosition.lat,
      lng: locatePosition.lon,
    });

    map.setZoom(16);
  }, [map, locatePosition, locateToken]);

  return null;
}

function CurrentRoutePolyline({
  route,
}: {
  route: RouteLive | null;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const coordinates =
      route?.geometry?.coordinates;

    if (!coordinates?.length) return;

    const path = coordinates.map(
      ([lon, lat]) => ({
        lat,
        lng: lon,
      }),
    );

    const polyline = new google.maps.Polyline({
      path,
      geodesic: true,
      strokeColor: "#b95f3b",
      strokeOpacity: 0.95,
      strokeWeight: 6,
      map,
    });

    return () => {
      polyline.setMap(null);
    };
  }, [map, route]);

  return null;
}

function TripRoutePolylines({
  paths,
  visible,
}: {
  paths: TripPath[];
  visible: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !visible) return;

    const polylines = paths
      .filter((item) => item.path.length > 1)
      .map((item) => {
        return new google.maps.Polyline({
          path: item.path,
          geodesic: true,
          strokeColor: "#b95f3b",
          strokeOpacity: 0.72,
          strokeWeight: 4,
          map,
        });
      });

    return () => {
      polylines.forEach((polyline) => {
        polyline.setMap(null);
      });
    };
  }, [map, paths, visible]);

  return null;
}

function InterdayTransferPolylines({
  transfers,
  visible,
}: {
  transfers: InterdayTransferPath[];
  visible: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map || !visible) return;

    const polylines = transfers.map(
      (transfer) =>
        new google.maps.Polyline({
          path: transfer.path,
          geodesic: true,
          strokeColor: "#755844",
          strokeOpacity: 0,
          strokeWeight: 4,
          icons: [
            {
              icon: {
                path: "M 0,-1 0,1",
                strokeOpacity: 0.8,
                scale: 3,
              },
              offset: "0",
              repeat: "14px",
            },
          ],
          map,
        }),
    );

    return () => {
      polylines.forEach((polyline) => polyline.setMap(null));
    };
  }, [map, transfers, visible]);

  return null;
}

function GoogleOperationalMap({
  day,
  days,
  currentPosition,
  nextLeg,
  route,
  onPositionChange,
  initialMode = "today",
  pageMode = false,
}: Props) {
  const [mode, setMode] =
    useState<"today" | "trip">(initialMode);

  const [expanded, setExpanded] =
    useState(false);

  const [userPosition, setUserPosition] =
    useState<DevicePosition | null>(
      currentPosition
        ? {
            ...currentPosition,
            accuracy: 0,
            updatedAt:
              new Date().toISOString(),
          }
        : null,
    );

  const [locateToken, setLocateToken] =
    useState(0);

  const [gpsState, setGpsState] =
    useState<
      "idle" | "loading" | "ready" | "error"
    >("idle");

  const [feedback, setFeedback] =
    useState("");

  const [selectedStop, setSelectedStop] =
    useState<ItineraryMapStop | null>(null);

  const [selectedGooglePlaceId, setSelectedGooglePlaceId] =
    useState<string | null>(null);

  const [placeLoading, setPlaceLoading] =
    useState(false);

  const [placeLookupFailed, setPlaceLookupFailed] =
    useState(false);
const planned =
    toGooglePoint(day?.coordinates);

  const destination =
    toGooglePoint(
      nextLeg?.destinationCoordinates,
    );

  /*
   * ONLY itinerary stops.
   *
   * FoodRecommendations and OptionalStops are separate
   * components/data sources and are intentionally not used here.
   */
  const itineraryStops =
    useMemo<ItineraryMapStop[]>(() => {
      const sourceDays =
        mode === "today"
          ? day
            ? [day]
            : []
          : days;

      return sourceDays.flatMap((tripDay) =>
        (tripDay.stops || [])
          .filter((stop) => !!stop.coordinates)
          .map((stop, index) => ({
            key: `${tripDay.dayNumber}-${stop.id ?? index}-${stop.name}`,
            name: stop.name,
            city: stop.city,
            dayNumber: tripDay.dayNumber,
            startTime: stop.startTime || null,
            coordinates: {
              lat: stop.coordinates!.lat,
              lng: stop.coordinates!.lon,
            },
          })),
      );
    }, [mode, day, days]);

  /*
   * One path per itinerary day.
   * Stop order is exactly the itinerary stop order.
   */
  const tripPaths =
    useMemo<TripPath[]>(() => {
      return days.map((tripDay) => ({
        dayNumber: tripDay.dayNumber,
        path: [...(tripDay.stops || [])]
          .filter((stop) => !!stop.coordinates)
          .sort((a, b) => a.sortOrder - b.sortOrder)
          .map((stop) => ({
            lat: stop.coordinates!.lat,
            lng: stop.coordinates!.lon,
          })),
      }));
    }, [days]);

  /*
   * Collegamento tra giornate consecutive:
   * ultima tappa del giorno N -> prima tappa del giorno N+1.
   *
   * Non crea record nel database.
   * ? una rappresentazione derivata dell'itinerario.
   */
  const interdayTransfers =
    useMemo<InterdayTransferPath[]>(() => {
      const result: InterdayTransferPath[] = [];

      for (let index = 0; index < days.length - 1; index += 1) {
        const currentDay = days[index];
        const nextDay = days[index + 1];

        const currentStops = [...(currentDay.stops || [])]
          .filter((stop) => !!stop.coordinates)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const nextStops = [...(nextDay.stops || [])]
          .filter((stop) => !!stop.coordinates)
          .sort((a, b) => a.sortOrder - b.sortOrder);

        const origin = currentStops[currentStops.length - 1];
        const destination = nextStops[0];

        if (!origin?.coordinates || !destination?.coordinates) {
          continue;
        }

        result.push({
          fromDay: currentDay.dayNumber,
          toDay: nextDay.dayNumber,
          originName: origin.name,
          destinationName: destination.name,
          path: [
            {
              lat: origin.coordinates.lat,
              lng: origin.coordinates.lon,
            },
            {
              lat: destination.coordinates.lat,
              lng: destination.coordinates.lon,
            },
          ],
        });
      }

      return result;
    }, [days]);

  const points = useMemo(() => {
    const result: MapPoint[] = [];

    /*
     * When viewing the whole trip we want the bounds
     * to represent Sicily / the itinerary, not Rome GPS.
     */
    if (mode === "today") {
      if (userPosition) {
        result.push({
          lat: userPosition.lat,
          lng: userPosition.lon,
        });
      } else if (planned) {
        result.push(planned);
      }

      if (destination) {
        result.push(destination);
      }
    }

    itineraryStops.forEach((stop) => {
      result.push(stop.coordinates);
    });

    return result;
  }, [
    mode,
    userPosition,
    planned,
    destination,
    itineraryStops,
  ]);

  const fallbackCenter =
    points[0] || {
      lat: 37.5,
      lng: 14.0,
    };

  const selectMapStop = async (
    stop: ItineraryMapStop,
  ) => {
    setSelectedStop(stop);
    setSelectedGooglePlaceId(null);
    setPlaceLookupFailed(false);
    setPlaceLoading(true);

    try {
      const { Place } =
        (await google.maps.importLibrary(
          "places",
        )) as google.maps.PlacesLibrary;

      const { places } =
        await Place.searchByText({
          textQuery: `${stop.name}, ${stop.city}, Sicilia`,
          fields: [
            "id",
            "displayName",
            "formattedAddress",
            "location",
          ],
          locationBias: {
            center: stop.coordinates,
            radius: 2500,
          },
          maxResultCount: 5,
          language: "it",
          region: "it",
        });

      if (!places.length) {
        setPlaceLookupFailed(true);
        return;
      }

      /*
       * Cerchiamo il risultato pi? vicino alle coordinate
       * dell'itinerario per evitare omonimie.
       */
      const candidates = places
        .filter((place) => place.id && place.location)
        .map((place) => {
          const lat = place.location!.lat();
          const lng = place.location!.lng();

          const dx =
            lat - stop.coordinates.lat;
          const dy =
            lng - stop.coordinates.lng;

          return {
            place,
            distance:
              dx * dx + dy * dy,
          };
        })
        .sort(
          (a, b) =>
            a.distance - b.distance,
        );

      const best =
        candidates[0]?.place;

      if (!best?.id) {
        setPlaceLookupFailed(true);
        return;
      }

      setSelectedGooglePlaceId(best.id);
    } catch (error) {
      console.error(
        "Google Place lookup failed:",
        error,
      );

      setPlaceLookupFailed(true);
    } finally {
      setPlaceLoading(false);
    }
  };

  const locate = async () => {
    setGpsState("loading");
    setFeedback("");

    try {
      const position =
        await platformService.currentPosition();

      setUserPosition(position);
      onPositionChange?.(position);

      setLocateToken((value) => value + 1);
      setGpsState("ready");

      setFeedback("Posizione aggiornata");

      window.setTimeout(
        () => setFeedback(""),
        1800,
      );
    } catch {
      setGpsState("error");

      setFeedback("GPS non disponibile");

      window.setTimeout(
        () => setFeedback(""),
        1800,
      );
    }
  };


  useEffect(() => {
    if (!currentPosition) return;

    setUserPosition({
      ...currentPosition,
      accuracy: 0,
      updatedAt:
        new Date().toISOString(),
    });
  }, [
    currentPosition?.lat,
    currentPosition?.lon,
  ]);

  return (
    <section
      className={[
        "operational-map",
        expanded ? "expanded" : "",
        pageMode ? "map-page-operational" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="map-toolbar">
        <div
          className="map-mode-switch"
          role="group"
          aria-label="Visualizzazione mappa"
        >
          <button
            type="button"
            className={
              mode === "today"
                ? "active"
                : ""
            }
            onClick={() =>
              setMode("today")
            }
          >
            <span className="map-mode-icon">
              &#9673;
            </span>

            <span>Oggi</span>
          </button>

          <button
            type="button"
            className={
              mode === "trip"
                ? "active"
                : ""
            }
            onClick={() =>
              setMode("trip")
            }
          >
            <span className="map-mode-icon">
              &#9671;
            </span>

            <span>Viaggio</span>
          </button>
        </div>

        <button
          className="map-expand-button"
          type="button"
          onClick={() =>
            setExpanded(
              (value) => !value,
            )
          }
        >
          {expanded
            ? "Riduci"
            : "Espandi"}
        </button>
      </div>

      <div className="map-shell">
        <Map
          defaultCenter={fallbackCenter}
          defaultZoom={11}
          mapId="pip-operational-map"
          gestureHandling="greedy"
          disableDefaultUI={false}
          clickableIcons
          style={{
            width: "100%",
            height: "100%",
          }}
        >
          <MapViewport
            points={points}
            locatePosition={userPosition}
            locateToken={locateToken}
          />

          {mode === "today" && (
            <CurrentRoutePolyline
              route={route}
            />
          )}

          <TripRoutePolylines
            paths={tripPaths}
            visible={mode === "trip"}
          />

          <InterdayTransferPolylines
            transfers={interdayTransfers}
            visible={mode === "trip"}
          />

          {userPosition &&
            mode === "today" && (
              <AdvancedMarker
                position={{
                  lat: userPosition.lat,
                  lng: userPosition.lon,
                }}
                title="La mia posizione"
              >
                <Pin
                  background="#4a382d"
                  borderColor="#fff9f1"
                  glyphColor="#fff9f1"
                  scale={1.15}
                />
              </AdvancedMarker>
            )}

          {!userPosition &&
            planned &&
            mode === "today" && (
              <AdvancedMarker
                position={planned}
                title="Posizione pianificata"
              >
                <Pin
                  background="#a48469"
                  borderColor="#fff9f1"
                  glyphColor="#fff9f1"
                  scale={1.05}
                />
              </AdvancedMarker>
            )}

          {destination &&
            mode === "today" && (
              <AdvancedMarker
                position={destination}
                title={
                  nextLeg?.destination ||
                  "Prossima destinazione"
                }
              >
                <Pin
                  background="#b95f3b"
                  borderColor="#fff9f1"
                  glyphColor="#fff9f1"
                  scale={1.25}
                />
              </AdvancedMarker>
            )}

          {itineraryStops.map((stop) => (
            <AdvancedMarker
              key={stop.key}
              position={stop.coordinates}
              title={
                `Giorno ${stop.dayNumber} ? ` +
                stop.name +
                (stop.city
                  ? ` ? ${stop.city}`
                  : "")
              }
              onClick={() => void selectMapStop(stop)}
            >
              <Pin
                background={
                  mode === "trip"
                    ? "#c98a66"
                    : "#b95f3b"
                }
                borderColor="#fff9f1"
                glyphColor="#4a382d"
                glyph={
                  mode === "trip"
                    ? String(stop.dayNumber)
                    : undefined
                }
                scale={
                  mode === "trip"
                    ? 0.9
                    : 1
                }
              />
            </AdvancedMarker>
          ))}

          {selectedStop && (
            <InfoWindow
              position={selectedStop.coordinates}
              onCloseClick={() => {
                setSelectedStop(null);
                setSelectedGooglePlaceId(null);
                setPlaceLookupFailed(false);
              }}
              pixelOffset={[0, -42]}
            >
              <div className="pip-google-place-preview">
                <div className="pip-google-place-context">
                  <small>
                    DAY {selectedStop.dayNumber}
                  </small>

                  {selectedStop.startTime && (
                    <span>
                      {selectedStop.startTime}
                    </span>
                  )}
                </div>

                {placeLoading && (
                  <div className="pip-place-loading">
                    Caricamento Google Maps?
                  </div>
                )}

                {selectedGooglePlaceId && (
                  <gmp-place-details-compact
                    orientation="VERTICAL"
                    truncation-preferred
                  >
                    <gmp-place-details-place-request
                      place={selectedGooglePlaceId}
                    />

                    <gmp-place-content-config>
                      <gmp-place-media
                        lightbox-preferred
                      />

                      <gmp-place-address />

                      <gmp-place-rating />

                      <gmp-place-type />

                      <gmp-place-open-now-status />

                      <gmp-place-attribution
                        light-scheme-color="black"
                        dark-scheme-color="white"
                      />
                    </gmp-place-content-config>
                  </gmp-place-details-compact>
                )}

                {(placeLookupFailed ||
                  (!placeLoading &&
                    !selectedGooglePlaceId)) && (
                  <div className="pip-map-info-window">
                    <strong>
                      {selectedStop.name}
                    </strong>

                    {selectedStop.city && (
                      <span>
                        {selectedStop.city}
                      </span>
                    )}

                    <a
                      href={`https://www.google.com/maps/dir/?api=1&destination=${selectedStop.coordinates.lat},${selectedStop.coordinates.lng}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Apri in Google Maps ?
                    </a>
                  </div>
                )}
              </div>
            </InfoWindow>
          )}

        </Map>

        <div className="map-floating-controls">
          <button
            className={`gps-button ${gpsState}`}
            onClick={locate}
            disabled={
              gpsState === "loading"
            }
            aria-label="Centra la mappa sulla mia posizione"
            title="La mia posizione"
          >
            <span aria-hidden="true">
              &#10148;
            </span>
          </button>
        </div>

        {mode === "trip" && (
          <div className="trip-map-legend">
            <strong>
              Itinerario completo
            </strong>
            <span>
              {itineraryStops.length} tappe
              {" \u00b7 "}
              {days.length} giorni
              {" \u00b7 "}
              {interdayTransfers.length} trasferimenti
            </span>
          </div>
        )}

        {feedback && (
          <div
            className="map-feedback"
            role="status"
          >
            {feedback}
          </div>
        )}
      </div>

      {mode === "today" && nextLeg && (
        <div className="map-route-overlay">
          <div>
            <small>
              PROSSIMA TRATTA
            </small>

            <strong>
              {nextLeg.origin}
              {" \u2192 "}
              {nextLeg.destination}
            </strong>

            {route?.distanceKm && (
              <span>
                {route.distanceKm} km
                {" \u00b7 "}
                {route.durationMinutes} min
              </span>
            )}
          </div>

          {destination && (
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${destination.lat},${destination.lng}`}
              target="_blank"
              rel="noreferrer"
            >
              Naviga
            </a>
          )}
        </div>
      )}

      {!navigator.onLine && (
        <small>
          Offline: Google Maps potrebbe
          non essere disponibile.
        </small>
      )}
    </section>
  );
}

export default function OperationalMap(
  props: Props,
) {
  const apiKey =
    import.meta.env
      .VITE_GOOGLE_MAPS_API_KEY;

  if (!apiKey) {
    return (
      <section className="operational-map">
        <div className="map-feedback">
          Google Maps non configurato
        </div>
      </section>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <GoogleOperationalMap
        {...props}
      />
    </APIProvider>
  );
}
