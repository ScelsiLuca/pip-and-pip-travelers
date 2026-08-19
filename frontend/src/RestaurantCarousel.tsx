import {
  useEffect,
  useRef,
  useState,
} from "react";

import { api } from "./api";
import type {
  Coordinates,
  RestaurantResponse,
} from "./types";

export const restaurantSavedKey = (
  location: string,
) =>
  `pip-restaurants:${location.toLowerCase()}`;

export const restaurantIsStale = (
  state: string,
  online: boolean,
) => state === "OFFLINE" || !online;

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

const elapsed = (iso: string) => {
  const minutes = Math.max(
    0,
    Math.round(
      (Date.now() -
        new Date(iso).getTime()) /
        60000,
    ),
  );

  return minutes < 1
    ? "ora"
    : `${minutes} min fa`;
};

const reviews = (
  value: number | null,
) =>
  value == null
    ? "—"
    : new Intl.NumberFormat(
        "it-IT",
      ).format(value);

const formatRouteDuration = (
  value: number | null,
) => {
  if (value == null) {
    return "—";
  }

  if (value < 60) {
    return `${value} min`;
  }

  const hours = Math.floor(
    value / 60,
  );

  const minutes =
    value % 60;

  return minutes
    ? `${hours} h ${minutes} min`
    : `${hours} h`;
};

const formatRouteDistance = (
  value: number | null,
) => {
  if (value == null) {
    return "—";
  }

  if (value < 1) {
    return `${Math.round(
      value * 1000,
    )} m`;
  }

  return `${value
    .toFixed(1)
    .replace(".", ",")} km`;
};

const mapsDirectionsUrl = (
  destination: Coordinates,
  travelMode?:
    | "driving"
    | "walking"
    | "transit",
) => {
  const params =
    new URLSearchParams({
      api: "1",
      destination: `${destination.lat},${destination.lon}`,
    });

  if (travelMode) {
    params.set(
      "travelmode",
      travelMode,
    );
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
};

export function RestaurantCarousel({
  location,
  coordinates,
}: {
  location: string;
  coordinates?: Coordinates | null;
}) {
  const [data, setData] =
    useState<RestaurantResponse | null>(
      null,
    );
  const carouselRef =
    useRef<HTMLDivElement | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [
    routesLoading,
    setRoutesLoading,
  ] = useState(false);

  const handleCarouselWheel = (
  event: React.WheelEvent<HTMLDivElement>,
) => {
  const carousel = carouselRef.current;

  if (!carousel) return;

  if (
    carousel.scrollWidth <=
    carousel.clientWidth
  ) {
    return;
  }

  if (
    Math.abs(event.deltaY) >
    Math.abs(event.deltaX)
  ) {
    event.preventDefault();

    carousel.scrollBy({
      left: event.deltaY,
      behavior: "smooth",
    });
  }
};

  const [routes, setRoutes] =
    useState<
      Record<
        string,
        RouteOptions
      >
    >({});

  const [error, setError] =
    useState("");

  const load = async (
    refresh = false,
  ) => {
    if (!location) {
      return;
    }

    setLoading(true);
    setError("");

    const params =
      new URLSearchParams({
        location,
        open_now: "true",
        limit: "8",
      });

    if (coordinates) {
      params.set(
        "lat",
        String(coordinates.lat),
      );

      params.set(
        "lon",
        String(coordinates.lon),
      );
    }

    if (refresh) {
      params.set(
        "refresh",
        "true",
      );
    }

    try {
      const result =
        await api<RestaurantResponse>(
          `/api/restaurants/recommended?${params}`,
        );

      setData(result);

      localStorage.setItem(
        restaurantSavedKey(
          location,
        ),
        JSON.stringify(result),
      );
    } catch {
      const saved =
        localStorage.getItem(
          restaurantSavedKey(
            location,
          ),
        );

      if (saved) {
        setData({
          ...JSON.parse(
            saved,
          ),
          dataState:
            "OFFLINE",
          cacheFresh: false,
        });
      } else {
        setError(
          "I ristoranti live non sono raggiungibili in questo momento.",
        );
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [
    location,
    coordinates?.lat,
    coordinates?.lon,
  ]);

  useEffect(() => {
    if (
      !coordinates ||
      !data?.restaurants.length
    ) {
      setRoutes({});
      setRoutesLoading(false);
      return;
    }

    let active = true;

    const origin: Coordinates = {
      lat: coordinates.lat,
      lon: coordinates.lon,
    };

    const loadRoutes =
      async () => {
        setRoutesLoading(
          true,
        );

        try {
          const entries =
            await Promise.all(
              data.restaurants.map(
                async (
                  item,
                ) => {
                  try {
                    const result =
                      await api<RouteOptions>(
                        "/api/routes/options",
                        {
                          method:
                            "POST",
                          body: JSON.stringify(
                            {
                              origin,
                              destination:
                                {
                                  lat: item
                                    .coordinates
                                    .lat,
                                  lon: item
                                    .coordinates
                                    .lon,
                                },
                            },
                          ),
                        },
                      );

                    return [
                      item.placeId,
                      result,
                    ] as const;
                  } catch {
                    return [
                      item.placeId,
                      null,
                    ] as const;
                  }
                },
              ),
            );

          if (!active) {
            return;
          }

          const next: Record<
            string,
            RouteOptions
          > = {};

          for (const [
            placeId,
            result,
          ] of entries) {
            if (result) {
              next[placeId] =
                result;
            }
          }

          setRoutes(next);
        } finally {
          if (active) {
            setRoutesLoading(
              false,
            );
          }
        }
      };

    void loadRoutes();

    return () => {
      active = false;
    };
  }, [
    data?.restaurants,
    coordinates?.lat,
    coordinates?.lon,
  ]);

  const stale =
    restaurantIsStale(
      data?.dataState || "",
      navigator.onLine,
    );

  return (
    <section className="restaurants-section">
      <header>
        <div>
          <small>
            SAPORI LOCALI
          </small>

          <h2>
            Dove mangiare ora
          </h2>

          <p>
            {location} · classifica
            basata sui dati
            disponibili
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            void load(true)
          }
          disabled={loading}
          aria-label="Aggiorna ristoranti"
        >
          ↻
        </button>
      </header>

      {data?.generatedAt && (
        <p className="restaurants-updated">
          {stale
            ? "Dati salvati"
            : "Aggiornato"}{" "}
          ·{" "}
          {elapsed(
            data.generatedAt,
          )}
        </p>
      )}

      {loading && !data && (
        <div className="restaurant-skeleton" />
      )}

      {error && (
        <p className="restaurants-empty">
          {error}
        </p>
      )}

      {data?.dataState ===
        "NOT_CONFIGURED" && (
        <p className="restaurants-empty">
          I ristoranti live
          saranno disponibili
          quando il servizio
          Google Places sarà
          configurato.
        </p>
      )}

      {data &&
        data.dataState !==
          "NOT_CONFIGURED" &&
        !data.restaurants
          .length && (
          <p className="restaurants-empty">
            Nessuno dei
            ristoranti
            selezionati risulta
            aperto ora.
          </p>
        )}

      {data &&
        data.restaurants
          .length > 0 && (
          <div
            ref={carouselRef}
            className="restaurant-carousel"
            onWheel={handleCarouselWheel}
>
            {data.restaurants.map(
              (
                item,
                index,
              ) => {
                const route =
                  routes[
                    item.placeId
                  ];

                const destination: Coordinates =
                  {
                    lat: item
                      .coordinates
                      .lat,
                    lon: item
                      .coordinates
                      .lon,
                  };

                return (
                  <article
                    className="restaurant-card"
                    key={
                      item.placeId
                    }
                  >
                    <span className="restaurant-rank">
                      #{index + 1}
                    </span>

                    <div>
                      <h3>
                        {item.name}
                      </h3>

                      <p
                        className={
                          stale
                            ? "open-state stale"
                            : "open-state"
                        }
                      >
                        {stale
                          ? "○ Orari da verificare"
                          : "● Aperto ora"}
                      </p>
                    </div>

                    <p className="restaurant-address">
                      {
                        item.address
                      }
                    </p>

                    <div className="rating-grid rating-grid-single">
                      <span>
                        <small>
                          GOOGLE
                          MAPS
                        </small>

                        <strong>
                          {item.googleRating?.toFixed(
                            1,
                          ) ??
                            "—"}{" "}
                          ★
                        </strong>

                        <em>
                          {reviews(
                            item.googleReviewCount,
                          )}{" "}
                          recensioni
                        </em>
                      </span>
                    </div>

                    <div className="restaurant-route-options">
                      {routesLoading &&
                      !route ? (
                        <small className="restaurant-routes-loading">
                          Calcolo
                          percorsi…
                        </small>
                      ) : route ? (
                        <>
                          <a
                            href={mapsDirectionsUrl(
                              destination,
                              "driving",
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="restaurant-route-mode"
                          >
                            <span>
                              🚗
                            </span>

                            <strong>
                              {formatRouteDuration(
                                route
                                  .car
                                  .durationMinutes,
                              )}
                            </strong>

                            <small>
                              {formatRouteDistance(
                                route
                                  .car
                                  .distanceKm,
                              )}
                            </small>
                          </a>

                          <a
                            href={mapsDirectionsUrl(
                              destination,
                              "walking",
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="restaurant-route-mode"
                          >
                            <span>
                              🚶
                            </span>

                            <strong>
                              {formatRouteDuration(
                                route
                                  .walk
                                  .durationMinutes,
                              )}
                            </strong>

                            <small>
                              {formatRouteDistance(
                                route
                                  .walk
                                  .distanceKm,
                              )}
                            </small>
                          </a>

                          <a
                            href={mapsDirectionsUrl(
                              destination,
                              "transit",
                            )}
                            target="_blank"
                            rel="noreferrer"
                            className="restaurant-route-mode"
                          >
                            <span>
                              🚌
                            </span>

                            <strong>
                              {route
                                .transit
                                .available
                                ? formatRouteDuration(
                                    route
                                      .transit
                                      .durationMinutes,
                                  )
                                : "—"}
                            </strong>

                            <small>
                              {route
                                .transit
                                .available
                                ? formatRouteDistance(
                                    route
                                      .transit
                                      .distanceKm,
                                  )
                                : "n/d"}
                            </small>
                          </a>
                        </>
                      ) : (
                        <small className="restaurant-routes-loading">
                          Percorso non
                          disponibile
                        </small>
                      )}
                    </div>

                    {item.priceLevel && (
                      <p className="price-level">
                        {item.priceLevel
                          .replace(
                            "PRICE_LEVEL_",
                            "",
                          )
                          .replaceAll(
                            "_",
                            " ",
                          )}
                      </p>
                    )}

                    {item.attributions?.map(
                      (
                        source,
                      ) => (
                        <small
                          className="place-attribution"
                          key={
                            source.provider
                          }
                        >
                          <span>
                            Dati:{" "}
                          </span>
                          {
                            source.provider
                          }
                        </small>
                      ),
                    )}

                    <a
                      className="restaurant-cta"
                      href={
                        item.googleMapsUrl
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      Apri in
                      Google Maps →
                    </a>
                  </article>
                );
              },
            )}
          </div>
        )}

      {data?.providers
        .google === "LIVE" && (
        <p className="provider-attribution">
          Dati dei luoghi,
          valutazioni e orari:
          Google Maps. Orari
          soggetti a variazioni.
        </p>
      )}
    </section>
  );
}