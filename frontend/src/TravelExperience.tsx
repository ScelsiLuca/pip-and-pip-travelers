import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  ItineraryStop,
  RouteLive,
  Trip,
  TripDay,
  TripRoute,
} from "./types";
import { api } from "./api";
import {
  guidesFromDays,
  poiIdentity,
  stopCount,
  writeStopStatus,
  type Guide,
  type TripStop,
  type StopStatus,
} from "./tripModel";
import {
  cityGuideContent,
  poiGuideContent,
  type PoiGuideContent,
} from "./guideContent";
import {
  DragDropContext,
  SortableDroppable,
  type DropResult,
  type SortableRenderState,
} from "./SortableTimeline";
import type { SavedPlace } from "./SavedPlaces";

export function BottomSheet({
  open,
  title,
  onClose,
  children,
  expanded = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  expanded?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    document.body.classList.add("sheet-open");
    ref.current?.focus();
    const key = (e: KeyboardEvent) =>
      e.key === "Escape" && onCloseRef.current();
    window.addEventListener("keydown", key);
    return () => {
      document.body.classList.remove("sheet-open");
      window.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="sheet-layer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className={`bottom-sheet ${expanded ? "expanded" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={ref}
      >
        <div className="sheet-handle" />
        <header>
          <div>
            <small>TRAVEL COMPANION</small>
            <h2>{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Chiudi">
            ×
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Toast({
  message,
  action,
  onAction,
}: {
  message: string;
  action?: string;
  onAction?: () => void;
}) {
  return message ? (
    <div className="pip-toast" role="status">
      <span>{message}</span>
      {action && <button onClick={onAction}>{action}</button>}
    </div>
  ) : null;
}
function ConfirmDialog({
  open,
  title,
  text,
  onCancel,
  onConfirm,
  danger = false,
}: {
  open: boolean;
  title: string;
  text: string;
  onCancel: () => void;
  onConfirm: () => void;
  danger?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="confirm-layer">
      <section className="pip-confirm" role="alertdialog" aria-modal="true">
        <small>CONFERMA</small>
        <h3>{title}</h3>
        <p>{text}</p>
        <div>
          <button onClick={onCancel}>Annulla</button>
          <button className={danger ? "danger" : ""} onClick={onConfirm}>
            Conferma
          </button>
        </div>
      </section>
    </div>
  );
}
const destination = (
  stop: Pick<TripStop, "coordinates" | "address" | "name" | "city">,
) =>
  stop.coordinates
    ? `${stop.coordinates.lat},${stop.coordinates.lon}`
    : stop.address?.trim() || `${stop.name}, ${stop.city}, Italia`;
const maps = (
  stop: Pick<TripStop, "coordinates" | "address" | "name" | "city">,
  mode: "dir" | "search" = "dir",
) =>
  mode === "dir"
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination(stop))}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination(stop))}`;

const routeMapsUrl = (route: TripRoute) => {
  const routeDestination = route.destinationCoordinates
    ? `${route.destinationCoordinates.lat},${route.destinationCoordinates.lon}`
    : route.destinationAddress?.trim() || route.destination;

  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    routeDestination,
  )}`;
};
function Editorial({ content }: { content: PoiGuideContent }) {
  return (
    <div className="poi-editorial">
      <section>
        <small>GENERAL INFO</small>
        <p className="guide-lead">{content.shortIntro}</p>
        {content.description && <p>{content.description}</p>}
      </section>

      {content.whyVisit && (
        <section>
          <small>PERCHÉ VISITARLO</small>
          <p>{content.whyVisit}</p>
        </section>
      )}

      {content.whatToSee && (
        <section className="fact-card">
          <small>DA GUARDARE</small>
          <p>{content.whatToSee}</p>
        </section>
      )}

      {content.practicalTips && (
        <section>
          <small>CONSIGLIO PIP & PIP</small>
          <p>{content.practicalTips}</p>
        </section>
      )}

      <a
        className="source-link"
        href={content.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        Fonte: {content.sourceLabel} {"\u2197"}
      </a>
    </div>
  );
}

function repairGuideText(value: string) {
  return value
    .replace(/\u00c3\u00a0/g, "\u00e0")
    .replace(/\u00c3\u00a8/g, "\u00e8")
    .replace(/\u00c3\u00a9/g, "\u00e9")
    .replace(/\u00c3\u00ac/g, "\u00ec")
    .replace(/\u00c3\u00b2/g, "\u00f2")
    .replace(/\u00c3\u00b9/g, "\u00f9")
    .replace(/\u00e2\u0080\u0099/g, "\u2019")
    .replace(/\u00e2\u0086\u0092/g, "\u2192")
    .replace(/u\u00ca\u00bb/g, "u'");
}

function normalizeGuideKey(value: string) {
  return repairGuideText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function guideForStop(stop: TripStop): PoiGuideContent {
  const specific =
    poiGuideContent[stop.id] ||
    poiGuideContent[normalizeGuideKey(stop.name)];

  if (specific) {
    return specific;
  }

  const cityKey = normalizeGuideKey(stop.city);
  const city = cityGuideContent[cityKey];

  if (city) {
    return {
      shortIntro: `${stop.name} \u00e8 una tappa del percorso a ${stop.city}.`,
      description: "",
      whyVisit:
        `La guida specifica non \u00e8 ancora presente, ma la tappa resta collegata al contesto di ${stop.city}.`,
      whatToSee:
        stop.notes ||
        "Osserva il luogo e il suo rapporto con il quartiere e con il paesaggio circostante.",
      practicalTips:
        city.localTip ||
        city.tips ||
        "Verifica sul posto eventuali orari, accessi e condizioni della visita.",
      sourceLabel: city.sourceLabel,
      sourceUrl: city.sourceUrl,
    };
  }

  return {
    shortIntro: `${stop.name} \u00e8 una tappa del viaggio in Sicilia.`,
    description: "",
    whyVisit:
      "La tappa \u00e8 stata inserita nell'itinerario come punto di interesse o sosta operativa.",
    whatToSee:
      stop.notes ||
      (stop.address
        ? `Il punto indicato si trova presso ${stop.address}.`
        : "Esplora il luogo e i dintorni con calma."),
    practicalTips:
      "Controlla le informazioni aggiornate prima della visita, soprattutto per accessi, orari e condizioni.",
    sourceLabel: "Google Maps",
    sourceUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${stop.name} ${stop.city}`,
    )}`,
  };
}

export function StopSheet({
  stop,
  onClose,
  onStatus,
  onGuide,
  onEdit,
}: {
  stop: TripStop | null;
  onClose: () => void;
  onStatus: (s: StopStatus) => void;
  onGuide: (city: string) => void;
  onEdit?: () => void;
}) {
  const content = stop ? guideForStop(stop) : null;
  return (
    <BottomSheet
      open={!!stop}
      title={stop?.name || ""}
      onClose={onClose}
      expanded={!!content}
    >
      {stop && (
        <>
          <p className="sheet-location">
            {stop.city} · {stop.kind === "experience" ? "Esperienza" : "Tappa"}
            {stop.startTime && (
              <small className="sheet-time"> · {stop.startTime}{stop.endTime?`–${stop.endTime}`:''}</small>
            )}
          </p>
          <span className={`status-dot ${stop.status}`}>
            {stop.status === "done"
              ? "Visitato"
              : stop.status === "skipped"
                ? "Saltato"
                : "Da visitare"}
          </span>
          {stop.address && (
            <a
              className="poi-address"
              href={maps(stop)}
              target="_blank"
              rel="noreferrer"
            >
              <small>INDIRIZZO</small>
              <strong>{stop.address}</strong>
              <span>Apri in Google Maps →</span>
            </a>
          )}
          {content ? (
            <Editorial content={content} />
          ) : (
            <p className="guide-missing">
              La scheda editoriale verificata non è ancora disponibile. La tappa
              resta collegata a itinerario, mappa e navigazione.
            </p>
          )}
          <div className="sheet-primary-actions">
            <a
              className="pip-primary"
              href={maps(stop)}
              target="_blank"
              rel="noreferrer"
            >
              Naviga →
            </a>
            <button
              className="pip-secondary"
              onClick={() => onGuide(stop.city)}
            >
              Guida città
            </button>
          </div>
          <div className="sheet-list">
            {onEdit && <button onClick={onEdit}>Modifica tappa</button>}
            {stop.status !== "done" && <button onClick={() => onStatus("done")}>✓ Segna come visitato</button>}
            {stop.status !== "planned" && <button onClick={() => onStatus("planned")}>Ripristina come da visitare</button>}
            {stop.status !== "skipped" && <button onClick={() => onStatus("skipped")}>Segna come saltato</button>}
          </div>
        </>
      )}
    </BottomSheet>
  );
}

type TimelineItem =
  | { kind: "stop"; id: number; sortOrder: number; stop: ItineraryStop }
  | { kind: "route"; id: number; sortOrder: number; route: TripRoute };
const timeline = (day: TripDay): TimelineItem[] =>
  [
    ...(day.stops || []).map((stop) => ({
      kind: "stop" as const,
      id: stop.id,
      sortOrder: stop.sortOrder,
      stop,
    })),
    ...day.routes.map((route) => ({
      kind: "route" as const,
      id: route.id,
      sortOrder: route.sortOrder ?? 0,
      route,
    })),
  ].sort((a, b) => a.sortOrder - b.sortOrder);
const asTripStop = (stop: ItineraryStop): TripStop => {
  const id = poiIdentity(stop.name, stop.city);
  return {
    id,
    key: id,
    backendId: stop.id,
    name: stop.name,
    city: stop.city,
    kind: stop.itemType === "experience" ? "experience" : "poi",
    address: stop.address,
    notes: stop.notes,
    coordinates: stop.coordinates,
    status:
      stop.status === "completed"
        ? "done"
        : stop.status === "skipped"
          ? "skipped"
          : "planned",
    sourceIndex: 0,
    sortOrder: stop.sortOrder,
    original: stop.original,
  };
};
type StopDraft = {
  id?: number;
  name: string;
  address: string;
  city: string;
  itemType: string;
  notes: string;
  startTime?: string;
  endTime?: string;
  coordinates: { lat: number; lon: number } | null;
};

type PlaceSuggestion = {
  placeId: string;
  text: string;
};

type GooglePlaceDetails = {
  placeId: string;
  name: string;
  city?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  googleMapsUrl?: string | null;
};

function StopEditor({
  open,
  draft,
  dayId,
  onClose,
  onSaved,
}: {
  open: boolean;
  draft: StopDraft | null;
  dayId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<StopDraft | null>(draft);
  const [initial, setInitial] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [placeSelected, setPlaceSelected] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);

  useEffect(() => {
    setValue(draft);
    setInitial(JSON.stringify(draft));
    setSearchQuery(draft?.name || "");
    setSuggestions([]);
    setPlaceSelected(!!draft?.coordinates);
    setError("");
  }, [draft]);

  useEffect(() => {
    if (
      !value ||
      placeSelected ||
      searchQuery.trim().length < 2
    ) {
      setSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setSearching(true);

      /*
       * Qui NON usiamo il GPS fisico dell'utente come bias.
       *
       * Quando modifichiamo l'itinerario potremmo essere,
       * ad esempio, a Roma mentre stiamo preparando una
       * tappa in Sicilia.
       */
      api<PlaceSuggestion[]>("/api/places/autocomplete", {
        method: "POST",
        body: JSON.stringify({
          input: searchQuery.trim(),
          latitude: null,
          longitude: null,
        }),
      })
        .then(setSuggestions)
        .catch(() => {
          setSuggestions([]);
          setError("Ricerca Google Places non disponibile.");
        })
        .finally(() => {
          setSearching(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [searchQuery, value?.id, placeSelected]);

  if (!value) return null;

  const dirty =
    JSON.stringify(value) !== initial ||
    searchQuery !== (draft?.name || "");

  const close = () =>
    dirty ? setDiscard(true) : onClose();

  const selectSuggestion = async (
    suggestion: PlaceSuggestion,
  ) => {
    try {
      setSearching(true);
      setError("");

      const place = await api<GooglePlaceDetails>(
        `/api/places/${encodeURIComponent(
          suggestion.placeId,
        )}`,
      );

      setValue((current) => {
        if (!current) return current;

        return {
          ...current,
          name: place.name || suggestion.text,
          address: place.address || "",
          city: place.city || current.city,
          coordinates:
            place.latitude != null &&
            place.longitude != null
              ? {
                  lat: place.latitude,
                  lon: place.longitude,
                }
              : null,
        };
      });

      setSearchQuery(place.name || suggestion.text);
      setPlaceSelected(true);
      setSuggestions([]);
      setError("");
    } catch {
      setError(
        "Impossibile recuperare i dettagli del luogo.",
      );
    } finally {
      setSearching(false);
    }
  };

  const save = async () => {
    if (!value.name.trim()) {
      setError(
        "Seleziona prima una location da Google Maps.",
      );
      return;
    }

    setSaving(true);
    setError("");

    const body = {
      name: value.name.trim(),
      city: value.city.trim(),
      item_type: value.itemType,
      address: value.address.trim() || null,
      notes: value.notes.trim() || null,
      start_time: value.startTime || null,
      end_time: value.endTime || null,
      coordinates: value.coordinates,
    };

    try {
      if (value.id) {
        await api(`/api/stops/${value.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/api/trip/${dayId}/stops`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }

      onSaved();
      onClose();
    } catch {
      setError("Salvataggio non riuscito. Riprova.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <BottomSheet
        open={open}
        title={
          value.id ? "Modifica tappa" : "Aggiungi tappa"
        }
        onClose={close}
        expanded
      >
        <form
          className="modern-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <div className="google-place-search trip-place-search">
            <label>
              {value.id
                ? "Cerca una nuova location su Google Maps"
                : "Cerca su Google Maps"}

              <input
                value={searchQuery}
                onChange={(event) => {
                  const next = event.target.value;

                  setSearchQuery(next);
                  setPlaceSelected(false);
                  setSuggestions([]);
                  setError("");

                  /*
                   * Appena l'utente modifica la ricerca
                   * invalidiamo la vecchia location.
                   *
                   * Manteniamo però città, tipo, orari
                   * e note della tappa.
                   */
                  setValue((current) =>
                    current
                      ? {
                          ...current,
                          name: "",
                          address: "",
                          coordinates: null,
                        }
                      : current,
                  );
                }}
                placeholder="Cerca luogo, spiaggia, museo..."
                autoComplete="off"
              />
            </label>

            {searching && (
              <small className="muted">
                Ricerca in corso…
              </small>
            )}

            {suggestions.length > 0 && (
              <div className="google-place-suggestions">
                {suggestions.map((suggestion) => (
                  <button
                    key={suggestion.placeId}
                    type="button"
                    onClick={() =>
                      void selectSuggestion(suggestion)
                    }
                  >
                    <span>📍</span>

                    <strong>{suggestion.text}</strong>
                  </button>
                ))}
              </div>
            )}

            {placeSelected &&
              value.coordinates && (
                <div className="google-place-selected">
                  ✓ Luogo selezionato da Google Maps
                </div>
              )}
          </div>

          <label>
            Indirizzo

            <input
              value={value.address}
              readOnly
              aria-readonly="true"
              placeholder="Seleziona prima una location"
            />
          </label>

          <div className="editor-grid">
           <label>
               Città / area

          <input
    value={value.city}
    readOnly
    aria-readonly="true"
    placeholder="Seleziona prima una location"
  />
</label>

            <label>
              Tipo

              <select
                value={value.itemType}
                onChange={(event) =>
                  setValue({
                    ...value,
                    itemType: event.target.value,
                  })
                }
              >
                <option value="poi">POI</option>
                <option value="experience">
                  Esperienza
                </option>
                <option value="food">Food</option>
                <option value="nature">Natura</option>
              </select>
            </label>

            <label>
              Ora inizio

              <input
                type="time"
                value={value.startTime || ""}
                onChange={(event) =>
                  setValue({
                    ...value,
                    startTime: event.target.value,
                  })
                }
              />
            </label>

            <label>
              Ora fine

              <input
                type="time"
                value={value.endTime || ""}
                onChange={(event) =>
                  setValue({
                    ...value,
                    endTime: event.target.value,
                  })
                }
              />
            </label>
          </div>

          <label>
            Note

            <textarea
              value={value.notes}
              onChange={(event) =>
                setValue({
                  ...value,
                  notes: event.target.value,
                })
              }
            />
          </label>

          {error && (
            <p className="editor-warning">{error}</p>
          )}

          <button
            className="pip-primary save-editor"
            disabled={
              saving ||
              (!value.id && !placeSelected)
            }
          >
            {saving ? "Salvataggio…" : "Salva modifiche"}
          </button>
        </form>
      </BottomSheet>

      <ConfirmDialog
        open={discard}
        title="Scartare le modifiche?"
        text="Le modifiche non salvate andranno perse."
        onCancel={() => setDiscard(false)}
        onConfirm={() => {
          setDiscard(false);
          onClose();
        }}
        danger
      />
    </>
  );
}
type RouteDraft = {
  id?: number;

  origin: string;
  originAddress: string;
  originCoordinates: { lat: number; lon: number } | null;

  destination: string;
  destinationAddress: string;
  destinationCoordinates: { lat: number; lon: number } | null;

  mode: string;
  plannedDurationMinutes: string;
  distanceKm: string;
};

function RouteEditor({
  open,
  draft,
  dayId,
  onClose,
  onSaved,
}: {
  open: boolean;
  draft: RouteDraft | null;
  dayId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<RouteDraft | null>(draft);
  const [initial, setInitial] = useState("");

  const [originQuery, setOriginQuery] = useState("");
  const [destinationQuery, setDestinationQuery] = useState("");

  const [originSuggestions, setOriginSuggestions] =
    useState<PlaceSuggestion[]>([]);

  const [destinationSuggestions, setDestinationSuggestions] =
    useState<PlaceSuggestion[]>([]);

  const [originSelected, setOriginSelected] = useState(false);
  const [destinationSelected, setDestinationSelected] =
    useState(false);

  const [searchingOrigin, setSearchingOrigin] = useState(false);
  const [searchingDestination, setSearchingDestination] =
    useState(false);

  const [calculatingRoute, setCalculatingRoute] = useState(false);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);

  useEffect(() => {
    setValue(draft);
    setInitial(JSON.stringify(draft));

    setOriginQuery(draft?.origin || "");
    setDestinationQuery(draft?.destination || "");

    setOriginSuggestions([]);
    setDestinationSuggestions([]);

    setOriginSelected(!!draft?.originCoordinates);
    setDestinationSelected(!!draft?.destinationCoordinates);

    setError("");
  }, [draft]);

  /*
   * Google Places autocomplete - PARTENZA
   */
  useEffect(() => {
    if (
      !value ||
      originSelected ||
      originQuery.trim().length < 2
    ) {
      setOriginSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setSearchingOrigin(true);

      api<PlaceSuggestion[]>("/api/places/autocomplete", {
        method: "POST",
        body: JSON.stringify({
          input: originQuery.trim(),
          latitude: null,
          longitude: null,
        }),
      })
        .then(setOriginSuggestions)
        .catch(() => {
          setOriginSuggestions([]);
          setError("Ricerca della partenza non disponibile.");
        })
        .finally(() => {
          setSearchingOrigin(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [originQuery, originSelected, value?.id]);

  /*
   * Google Places autocomplete - DESTINAZIONE
   */
  useEffect(() => {
    if (
      !value ||
      destinationSelected ||
      destinationQuery.trim().length < 2
    ) {
      setDestinationSuggestions([]);
      return;
    }

    const timer = window.setTimeout(() => {
      setSearchingDestination(true);

      api<PlaceSuggestion[]>("/api/places/autocomplete", {
        method: "POST",
        body: JSON.stringify({
          input: destinationQuery.trim(),
          latitude: null,
          longitude: null,
        }),
      })
        .then(setDestinationSuggestions)
        .catch(() => {
          setDestinationSuggestions([]);
          setError("Ricerca della destinazione non disponibile.");
        })
        .finally(() => {
          setSearchingDestination(false);
        });
    }, 250);

    return () => window.clearTimeout(timer);
  }, [
    destinationQuery,
    destinationSelected,
    value?.id,
  ]);

  /*
   * Calcolo automatico del tragitto.
   *
   * Auto  -> Google Routes + traffico corrente.
   * Walk  -> Google Routes pedonale.
   */
  useEffect(() => {
    if (
      !value?.originCoordinates ||
      !value?.destinationCoordinates ||
      !["car", "walk"].includes(value.mode)
    ) {
      return;
    }

    let active = true;

    const timer = window.setTimeout(() => {
      setCalculatingRoute(true);
      setError("");

      api<RouteLive>("/api/routes/preview", {
        method: "POST",
        body: JSON.stringify({
          origin: value.originCoordinates,
          destination: value.destinationCoordinates,
          mode: value.mode,
        }),
      })
        .then((result) => {
          if (!active) return;

          if (
            result.dataState === "ERROR" ||
            result.dataState === "NOT_CONFIGURED"
          ) {
            setError(
              "Non è stato possibile calcolare il tragitto con Google Maps.",
            );
            return;
          }

          setValue((current) => {
            if (!current) return current;

            return {
              ...current,
              plannedDurationMinutes:
                result.durationMinutes != null
                  ? String(result.durationMinutes)
                  : "",
              distanceKm:
                result.distanceKm != null
                  ? String(result.distanceKm)
                  : "",
            };
          });
        })
        .catch(() => {
          if (active) {
            setError(
              "Non è stato possibile calcolare il tragitto con Google Maps.",
            );
          }
        })
        .finally(() => {
          if (active) {
            setCalculatingRoute(false);
          }
        });
    }, 200);

    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [
    value?.originCoordinates?.lat,
    value?.originCoordinates?.lon,
    value?.destinationCoordinates?.lat,
    value?.destinationCoordinates?.lon,
    value?.mode,
  ]);

  if (!value) return null;

  const dirty = JSON.stringify(value) !== initial;

  const close = () =>
    dirty ? setDiscard(true) : onClose();

  const selectOrigin = async (
    suggestion: PlaceSuggestion,
  ) => {
    try {
      setSearchingOrigin(true);
      setError("");

      const place = await api<GooglePlaceDetails>(
        `/api/places/${encodeURIComponent(
          suggestion.placeId,
        )}`,
      );

      setValue((current) => {
        if (!current) return current;

        return {
          ...current,
          origin: place.name || suggestion.text,
          originAddress: place.address || "",
          originCoordinates:
            place.latitude != null &&
            place.longitude != null
              ? {
                  lat: place.latitude,
                  lon: place.longitude,
                }
              : null,

          /*
           * Invalidiamo il vecchio calcolo.
           */
          plannedDurationMinutes: "",
          distanceKm: "",
        };
      });

      setOriginQuery(place.name || suggestion.text);
      setOriginSelected(true);
      setOriginSuggestions([]);
    } catch {
      setError(
        "Impossibile recuperare i dettagli della partenza.",
      );
    } finally {
      setSearchingOrigin(false);
    }
  };

  const selectDestination = async (
    suggestion: PlaceSuggestion,
  ) => {
    try {
      setSearchingDestination(true);
      setError("");

      const place = await api<GooglePlaceDetails>(
        `/api/places/${encodeURIComponent(
          suggestion.placeId,
        )}`,
      );

      setValue((current) => {
        if (!current) return current;

        return {
          ...current,
          destination: place.name || suggestion.text,
          destinationAddress: place.address || "",
          destinationCoordinates:
            place.latitude != null &&
            place.longitude != null
              ? {
                  lat: place.latitude,
                  lon: place.longitude,
                }
              : null,

          plannedDurationMinutes: "",
          distanceKm: "",
        };
      });

      setDestinationQuery(place.name || suggestion.text);
      setDestinationSelected(true);
      setDestinationSuggestions([]);
    } catch {
      setError(
        "Impossibile recuperare i dettagli della destinazione.",
      );
    } finally {
      setSearchingDestination(false);
    }
  };

  const formatDuration = (minutes: number) => {
    if (minutes < 60) {
      return `${minutes} min`;
    }

    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;

    if (!remaining) {
      return `${hours} h`;
    }

    return `${hours} h ${remaining} min`;
  };

  const save = async () => {
    if (
      !value.originCoordinates ||
      !value.destinationCoordinates
    ) {
      setError(
        "Seleziona partenza e destinazione da Google Maps.",
      );
      return;
    }

    if (
      ["car", "walk"].includes(value.mode) &&
      !value.plannedDurationMinutes
    ) {
      setError(
        "Attendi il calcolo del tragitto prima di salvare.",
      );
      return;
    }

    setSaving(true);
    setError("");

    const body = {
      origin: value.origin,
      destination: value.destination,

      /*
       * Gli indirizzi non sono più mostrati
       * all'utente, ma continuiamo a salvarli
       * nel database.
       */
      origin_address: value.originAddress || null,
      destination_address:
        value.destinationAddress || null,

      origin_coordinates: value.originCoordinates,
      destination_coordinates:
        value.destinationCoordinates,

      mode: value.mode,

      planned_duration_minutes:
        value.plannedDurationMinutes
          ? Number(value.plannedDurationMinutes)
          : null,

      distance_km:
        value.distanceKm
          ? Number(value.distanceKm)
          : null,
    };

    try {
      if (value.id) {
        await api(`/api/routes/item/${value.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        await api(`/api/trip/${dayId}/routes`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      }

      onSaved();
      onClose();
    } catch {
      setError("Salvataggio non riuscito.");
    } finally {
      setSaving(false);
    }
  };

  const automaticMode =
    value.mode === "car" || value.mode === "walk";

  return (
    <>
      <BottomSheet
        open={open}
        title={
          value.id
            ? "Modifica trasferimento"
            : "Nuovo trasferimento"
        }
        onClose={close}
        expanded
      >
        <form
          className="modern-editor route-editor"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {/* PARTENZA */}

          <div className="google-place-search route-place-search">
            <label>
              Partenza

              <input
                value={originQuery}
                onChange={(event) => {
                  const next = event.target.value;

                  setOriginQuery(next);
                  setOriginSelected(false);
                  setOriginSuggestions([]);
                  setError("");

                  setValue((current) =>
                    current
                      ? {
                          ...current,
                          origin: "",
                          originAddress: "",
                          originCoordinates: null,
                          plannedDurationMinutes: "",
                          distanceKm: "",
                        }
                      : current,
                  );
                }}
                placeholder="Cerca luogo di partenza..."
                autoComplete="off"
              />
            </label>

            {searchingOrigin && (
              <small className="muted">
                Ricerca in corso…
              </small>
            )}

            {originSuggestions.length > 0 && (
              <div className="google-place-suggestions">
                {originSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.placeId}
                    type="button"
                    onClick={() =>
                      void selectOrigin(suggestion)
                    }
                  >
                    <span>📍</span>
                    <strong>{suggestion.text}</strong>
                  </button>
                ))}
              </div>
            )}

            {originSelected &&
              value.originCoordinates && (
                <div className="google-place-selected">
                  ✓ Partenza selezionata
                </div>
              )}
          </div>

          {/* DESTINAZIONE */}

          <div className="google-place-search route-place-search">
            <label>
              Destinazione

              <input
                value={destinationQuery}
                onChange={(event) => {
                  const next = event.target.value;

                  setDestinationQuery(next);
                  setDestinationSelected(false);
                  setDestinationSuggestions([]);
                  setError("");

                  setValue((current) =>
                    current
                      ? {
                          ...current,
                          destination: "",
                          destinationAddress: "",
                          destinationCoordinates: null,
                          plannedDurationMinutes: "",
                          distanceKm: "",
                        }
                      : current,
                  );
                }}
                placeholder="Cerca destinazione..."
                autoComplete="off"
              />
            </label>

            {searchingDestination && (
              <small className="muted">
                Ricerca in corso…
              </small>
            )}

            {destinationSuggestions.length > 0 && (
              <div className="google-place-suggestions">
                {destinationSuggestions.map(
                  (suggestion) => (
                    <button
                      key={suggestion.placeId}
                      type="button"
                      onClick={() =>
                        void selectDestination(
                          suggestion,
                        )
                      }
                    >
                      <span>📍</span>
                      <strong>
                        {suggestion.text}
                      </strong>
                    </button>
                  ),
                )}
              </div>
            )}

            {destinationSelected &&
              value.destinationCoordinates && (
                <div className="google-place-selected">
                  ✓ Destinazione selezionata
                </div>
              )}
          </div>

          {/* MODALITÀ */}

          <label>
            Tipo

            <select
              value={value.mode}
              onChange={(event) => {
                const nextMode = event.target.value;

                setValue({
                  ...value,
                  mode: nextMode,
                  plannedDurationMinutes:
                    ["car", "walk"].includes(nextMode)
                      ? ""
                      : value.plannedDurationMinutes,
                  distanceKm:
                    ["car", "walk"].includes(nextMode)
                      ? ""
                      : value.distanceKm,
                });
              }}
            >
              <option value="car">Auto</option>
              <option value="walk">A piedi</option>
              <option value="boat">Barca</option>
              <option value="other">Altro</option>
            </select>
          </label>

          {/* RISULTATO GOOGLE ROUTES */}

          {automaticMode &&
            value.originCoordinates &&
            value.destinationCoordinates && (
              <div className="route-calculation-card">
                <small>TRAGITTO</small>

                {calculatingRoute ? (
                  <div className="route-calculating">
                    Calcolo percorso con Google Maps…
                  </div>
                ) : value.plannedDurationMinutes ? (
                  <>
                    <strong>
                      {formatDuration(
                        Number(
                          value.plannedDurationMinutes,
                        ),
                      )}

                      {value.distanceKm && (
                        <>
                          {" "}
                          ·{" "}
                          {Number(
                            value.distanceKm,
                          )
                            .toFixed(1)
                            .replace(".", ",")}{" "}
                          km
                        </>
                      )}
                    </strong>

                    <span>
                      {value.mode === "car"
                        ? "Durata calcolata con il traffico attuale"
                        : "Percorso pedonale calcolato da Google Maps"}
                    </span>
                  </>
                ) : (
                  <span>
                    Seleziona partenza e destinazione.
                  </span>
                )}
              </div>
            )}

          {/* BARCA / ALTRO */}

          {!automaticMode && (
            <label>
              Durata prevista

              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={value.plannedDurationMinutes}
                onChange={(event) =>
                  setValue({
                    ...value,
                    plannedDurationMinutes:
                      event.target.value,
                    distanceKm: "",
                  })
                }
                placeholder="Minuti"
              />
            </label>
          )}

          {error && (
            <p className="editor-warning">
              {error}
            </p>
          )}

          <button
            className="pip-primary save-editor"
            disabled={
              saving ||
              calculatingRoute ||
              !originSelected ||
              !destinationSelected
            }
          >
            {saving
              ? "Salvataggio…"
              : "Salva trasferimento"}
          </button>
        </form>
      </BottomSheet>

      <ConfirmDialog
        open={discard}
        title="Scartare le modifiche?"
        text="Le modifiche non salvate andranno perse."
        onCancel={() => setDiscard(false)}
        onConfirm={() => {
          setDiscard(false);
          onClose();
        }}
        danger
      />
    </>
  );
}
function LiveRouteInfo({
  route,
}: {
  route: TripRoute;
}) {
  const [live, setLive] = useState<RouteLive | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (
      !route.originCoordinates ||
      !route.destinationCoordinates ||
      !["car", "walk"].includes(route.mode || "car")
    ) {
      setLive(null);
      return;
    }

    let active = true;

    const refresh = async () => {
      try {
        setLoading(true);

        const result = await api<RouteLive>("/api/routes/preview", {
          method: "POST",
          body: JSON.stringify({
            origin: route.originCoordinates,
            destination: route.destinationCoordinates,
            mode: route.mode || "car",
          }),
        });

        if (
          active &&
          result.dataState !== "ERROR" &&
          result.dataState !== "NOT_CONFIGURED"
        ) {
          setLive(result);
        }
      } catch {
        // Manteniamo la stima salvata se l'aggiornamento live non è disponibile.
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void refresh();

    const interval = window.setInterval(
      () => void refresh(),
      5 * 60 * 1000,
    );

    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [
    route.id,
    route.mode,
    route.originCoordinates?.lat,
    route.originCoordinates?.lon,
    route.destinationCoordinates?.lat,
    route.destinationCoordinates?.lon,
  ]);

  const duration = live?.durationMinutes ?? route.plannedDurationMinutes;
  const distance = live?.distanceKm ?? route.distanceKm;

  const formatDuration = (minutes: number) => {
    if (minutes < 60) return `${minutes} min`;

    const hours = Math.floor(minutes / 60);
    const remaining = minutes % 60;

    return remaining ? `${hours} h ${remaining} min` : `${hours} h`;
  };

  if (duration == null && distance == null) {
    return (
      <div className="route-live-info">
        <span>{loading ? "Calcolo del tragitto…" : "Durata da calcolare"}</span>
      </div>
    );
  }

  return (
    <div className="route-live-info">
      <strong>
        {duration != null ? formatDuration(duration) : ""}

        {distance != null && (
          <>
            {duration != null ? " · " : ""}
            {distance.toFixed(1).replace(".", ",")} km
          </>
        )}
      </strong>

      {loading ? (
        <small>Aggiornamento traffico…</small>
      ) : live ? (
        <small>
          {route.mode === "car"
            ? live.trafficDelayMinutes != null &&
              live.trafficDelayMinutes > 0
              ? `Traffico attuale · +${live.trafficDelayMinutes} min`
              : "Traffico attuale"
            : "Percorso pedonale aggiornato"}
        </small>
      ) : (
        <small>Stima salvata</small>
      )}
    </div>
  );
}

function StopRow({
  stop,
  editMode,
  menu,
  onMenu,
  onOpen,
  onEdit,
  onStatus,
  onDelete,
  dragHandleProps,
}: {
  stop: ItineraryStop;
  editMode: boolean;
  menu: boolean;
  onMenu: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onStatus: (status: StopStatus) => void;
  onDelete: () => void;
  dragHandleProps: SortableRenderState["dragHandleProps"];
}) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return;

    const closeIfOutside = (event: PointerEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node)
      ) {
        onMenu();
      }
    };

    window.addEventListener("pointerdown", closeIfOutside);

    return () => {
      window.removeEventListener("pointerdown", closeIfOutside);
    };
  }, [menu, onMenu]);

  const statusText =
    stop.status === "completed"
      ? "Tappa visitata"
      : stop.status === "skipped"
        ? "Tappa saltata"
        : "Tappa da visitare";

  return (
    <article
      className={`editable-stop ${stop.status}${
        menu ? " quick-menu-open" : ""
      }`}
    >
      <div className="stop-status-wrap" ref={menuRef}>
        <button
          type="button"
          className={`stop-status-button ${stop.status}`}
          aria-label={`${statusText}: apri azioni per ${stop.name}`}
          aria-haspopup="menu"
          aria-expanded={menu}
          onClick={(event) => {
            event.stopPropagation();
            onMenu();
          }}
        >
          <span className="stop-status-core">
            {stop.status === "completed"
              ? "✓"
              : stop.status === "skipped"
                ? "↷"
                : ""}
          </span>
        </button>

        {menu && (
          <div
            className="stop-quick-menu"
            role="menu"
            aria-label={`Azioni per ${stop.name}`}
          >
            {stop.status !== "completed" && (
              <button
                type="button"
                role="menuitem"
                onClick={() => onStatus("done")}
              >
                <span className="quick-action-icon success">✓</span>
                <span>
                  <strong>Tappa visitata</strong>
                  <small>Segna come completata</small>
                </span>
              </button>
            )}

            {stop.status !== "skipped" && (
              <button
                type="button"
                role="menuitem"
                onClick={() => onStatus("skipped")}
              >
                <span className="quick-action-icon">↷</span>
                <span>
                  <strong>Salta tappa</strong>
                  <small>Continua con la successiva</small>
                </span>
              </button>
            )}

            {stop.status !== "planned" && (
              <button
                type="button"
                role="menuitem"
                onClick={() => onStatus("planned")}
              >
                <span className="quick-action-icon">○</span>
                <span>
                  <strong>Da visitare</strong>
                  <small>Ripristina lo stato iniziale</small>
                </span>
              </button>
            )}

            <div className="stop-quick-divider" />

            <button
              type="button"
              role="menuitem"
              onClick={onEdit}
            >
              <span className="quick-action-icon">✎</span>
              <span>
                <strong>Modifica tappa</strong>
                <small>Orario, luogo e dettagli</small>
              </span>
            </button>

            {editMode && (
              <button
                type="button"
                role="menuitem"
                className="quick-danger"
                onClick={onDelete}
              >
                <span className="quick-action-icon">×</span>
                <span>
                  <strong>Elimina tappa</strong>
                  <small>Rimuovi dall'itinerario</small>
                </span>
              </button>
            )}
          </div>
        )}
      </div>

      <time className="stop-time">
        {stop.startTime || "—"}
      </time>

      <button
        type="button"
        className="stop-content"
        onClick={onOpen}
      >
        <strong>{stop.name}</strong>

        <small>
          {stop.itemType === "experience"
            ? "Esperienza"
            : "Tappa"}{" "}
          · {stop.city}
        </small>

        {stop.address && (
          <em>{stop.address}</em>
        )}
      </button>

      <div className="stop-row-actions">
        <a
          className="timeline-map-link"
          href={maps(asTripStop(stop))}
          target="_blank"
          rel="noreferrer"
          aria-label={`Naviga verso ${stop.name} con Google Maps`}
          title="Apri in Google Maps"
          onClick={(event) => event.stopPropagation()}
        >
          →
        </a>

        {editMode && (
          <button
            type="button"
            className="drag-handle"
            aria-label={`Trascina ${stop.name} per riordinare`}
            title="Trascina per riordinare"
            {...dragHandleProps}
          >
            <span />
            <span />
            <span />
          </button>
        )}
      </div>
    </article>
  );
}

function derivedInterdayTransfer(
  trip: Trip,
  day: TripDay,
): TripRoute | null {
  const dayIndex = trip.days.findIndex(
    (item) => item.id === day.id,
  );

  if (
    dayIndex < 0 ||
    dayIndex >= trip.days.length - 1
  ) {
    return null;
  }

  const nextDay = trip.days[dayIndex + 1];

  const currentStops = [...(day.stops || [])]
    .filter((stop) => !!stop.coordinates)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const nextStops = [...(nextDay.stops || [])]
    .filter((stop) => !!stop.coordinates)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const origin =
    currentStops[currentStops.length - 1];

  const destination = nextStops[0];

  if (
    !origin?.coordinates ||
    !destination?.coordinates
  ) {
    return null;
  }

  /*
   * Se il giorno contiene gi? almeno un trasferimento reale,
   * non ne generiamo uno automatico.
   *
   * I TripRoute esistenti hanno priorit? perch? fanno parte
   * dell'itinerario salvato e possono avere origine/destinazione
   * leggermente diverse dalle coordinate delle tappe.
   */
  if ((day.routes || []).length > 0) {
    return null;
  }

  return {
    /*
     * ID negativo solo lato frontend.
     * Non viene mai persistito n? modificato.
     */
    id: -(100000 + day.dayNumber),

    origin: origin.name,
    destination: destination.name,

    originAddress: origin.address || null,
    destinationAddress: destination.address || null,

    originCoordinates: origin.coordinates,
    destinationCoordinates: destination.coordinates,

    plannedDeparture: null,
    plannedDurationMinutes: null,
    distanceKm: null,

    mode: "car",

    sortOrder: Number.MAX_SAFE_INTEGER,
  };
}

export function ModernTripView({
  trip,
  onGuide,
  onChanged,
}: {
  trip: Trip;
  onGuide: (name: string) => void;
  onChanged: () => void;
}) {
  const [selectedId, setSelectedId] = useState(
      (trip.days.find((d) => d.date === trip.context.today) || trip.days[0]).id,
    ),
    [active, setActive] = useState<TripStop | null>(null),
    [editMode, setEditMode] = useState(false),
    [menu, setMenu] = useState<string | null>(null),
    [stopDraft, setStopDraft] = useState<StopDraft | null>(null),
    [routeDraft, setRouteDraft] = useState<RouteDraft | null>(null),
    [toast, setToast] = useState(""),
    [undo, setUndo] = useState<{ kind: "stop" | "route"; id: number } | null>(
      null,
    ),
    [confirmDelete, setConfirmDelete] = useState<TimelineItem | null>(null),
    [confirmReset, setConfirmReset] = useState(false),
    [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]),
    [promotionTime, setPromotionTime] = useState(""),
    [pendingPromotion, setPendingPromotion] = useState<{
      place: SavedPlace;
      sourceType: "optional" | "food";
      targetIndex: number;
    } | null>(null);
  const selected =
      trip.days.find((d) => d.id === selectedId) || trip.days[0],
    items = useMemo(() => timeline(selected), [selected]),
    nextDayTransfer = useMemo(
      () => derivedInterdayTransfer(trip, selected),
      [trip, selected],
    ),
    optionalPlaces = useMemo(
      () =>
        savedPlaces
          .filter(
            (place) =>
              place.trip_day_id === selected.id &&
              place.category === "optional",
          )
          .sort(
            (a, b) =>
              (a.sort_order ?? 0) - (b.sort_order ?? 0),
          ),
      [savedPlaces, selected.id],
    ),
    foodPlaces = useMemo(
      () =>
        savedPlaces
          .filter(
            (place) =>
              place.trip_day_id === selected.id &&
              place.category === "food",
          )
          .sort(
            (a, b) =>
              (a.sort_order ?? 0) - (b.sort_order ?? 0),
          ),
      [savedPlaces, selected.id],
    );

  const loadSavedPlaces = async () => {
    try {
      const all = await api<SavedPlace[]>("/api/saved");
      setSavedPlaces(all);
    } catch {
      setSavedPlaces([]);
    }
  };

  useEffect(() => {
    void loadSavedPlaces();
  }, [selected.id, trip]);
  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(""), 2200);
  };
  const reorder = async (next: TimelineItem[]) => {
    await api(`/api/trip/${selected.id}/reorder`, {
      method: "POST",
      body: JSON.stringify({
        items: next.map((item) => ({ kind: item.kind, id: item.id })),
      }),
    });
    onChanged();
    flash("Nuovo ordine salvato");
  };

  const moveBoardItem = async (
    sourceType: "itinerary" | "optional" | "food",
    sourceId: number,
    targetType: "itinerary" | "optional" | "food",
    targetIndex: number,
    startTime?: string,
  ) => {
    await api("/api/trip/items/move", {
      method: "POST",
      body: JSON.stringify({
        source_type: sourceType,
        source_id: sourceId,
        target_type: targetType,
        trip_day_id: selected.id,
        target_index: targetIndex,
        start_time: startTime || null,
      }),
    });

    await loadSavedPlaces();
    onChanged();
  };

  const boardDragEnd = async (result: DropResult) => {
    const destination = result.destination;

    if (!destination) return;

    const sourceType = result.source.droppableId as
      | "itinerary"
      | "optional"
      | "food";

    const targetType = destination.droppableId as
      | "itinerary"
      | "optional"
      | "food";

    if (
      sourceType === targetType &&
      result.source.index === destination.index
    ) {
      return;
    }

    if (
      sourceType === "itinerary" &&
      targetType === "itinerary"
    ) {
      const next = [...items];
      const [moved] = next.splice(
        result.source.index,
        1,
      );

      next.splice(
        destination.index,
        0,
        moved,
      );

      await reorder(next);
      return;
    }

    if (sourceType === "itinerary") {
      const item = items[result.source.index];

      if (!item) return;

      if (item.kind === "route") {
        flash(
          "I trasferimenti possono essere riordinati solo nell'itinerario",
        );
        return;
      }

      try {
        await moveBoardItem(
          "itinerary",
          item.id,
          targetType,
          destination.index,
        );

        flash(
          targetType === "food"
            ? "Tappa spostata in Food consigliato"
            : "Tappa spostata nelle tappe aggiuntive",
        );
      } catch {
        flash("Impossibile spostare la tappa");
      }

      return;
    }

    const sourceList =
      sourceType === "food"
        ? foodPlaces
        : optionalPlaces;

    const place = sourceList[result.source.index];

    if (!place) return;

    if (targetType === "itinerary") {
      setPendingPromotion({
        place,
        sourceType,
        targetIndex: destination.index,
      });

      setPromotionTime("");
      return;
    }

    try {
      await moveBoardItem(
        sourceType,
        place.id,
        targetType,
        destination.index,
      );

      flash(
        targetType === "food"
          ? "Spostato in Food consigliato"
          : "Spostato nelle tappe aggiuntive",
      );
    } catch {
      flash("Impossibile spostare la location");
    }
  };

  const confirmPromotion = async () => {
    if (!pendingPromotion || !promotionTime) return;

    try {
      await moveBoardItem(
        pendingPromotion.sourceType,
        pendingPromotion.place.id,
        "itinerary",
        pendingPromotion.targetIndex,
        promotionTime,
      );

      setPendingPromotion(null);
      setPromotionTime("");

      flash("Tappa aggiunta all'itinerario");
    } catch {
      flash(
        "Impossibile aggiungere la tappa all'itinerario",
      );
    }
  };

  const savedPlaceAsTripStop = (
    place: SavedPlace,
    label: "Tappa Aggiuntiva" | "Food Consigliato",
  ): TripStop => {
    const city =
      selected.baseCity ||
      selected.title ||
      "Sicilia";

    return {
      id: poiIdentity(place.name, city),
      key: `saved-${place.id}`,
      name: place.name,
      city,
      kind: "poi",
      address: place.address || undefined,
      notes: place.notes || label,
      coordinates:
        place.latitude != null &&
        place.longitude != null
          ? {
              lat: place.latitude,
              lon: place.longitude,
            }
          : null,
      status: "planned",
      sourceIndex: 0,
      sortOrder: place.sort_order ?? 0,
      original: false,
    };
  };

  const savedMapsUrl = (place: SavedPlace) => {
    if (place.link) return place.link;

    if (
      place.latitude != null &&
      place.longitude != null
    ) {
      return `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;
    }

    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${place.name} ${place.address || ""}`,
    )}`;
  };

  const status = async (stop: TripStop, value: StopStatus) => {
    if (stop.backendId)
      await api(`/api/stops/${stop.backendId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: value === "done" ? "completed" : value,
        }),
      });
    writeStopStatus(stop.id, value);
    setActive(null);
    onChanged();
    flash(value === "done" ? "Tappa completata" : value === "skipped" ? "Tappa saltata" : "Tappa ripristinata come da visitare");
  };
  const remove = async () => {
    if (!confirmDelete) return;
    const item = confirmDelete;
    if (item.kind === "stop")
      await api(`/api/stops/${item.id}`, { method: "DELETE" });
    else await api(`/api/routes/item/${item.id}`, { method: "DELETE" });
    setConfirmDelete(null);
    setUndo({ kind: item.kind, id: item.id });
    onChanged();
    flash(item.kind === "stop" ? "Tappa eliminata" : "Trasferimento eliminato");
  };
  const undoDelete = async () => {
    if (!undo) return;
    await api(
      undo.kind === "stop"
        ? `/api/stops/${undo.id}/restore`
        : `/api/routes/item/${undo.id}/restore`,
      { method: "POST" },
    );
    setUndo(null);
    onChanged();
    flash("Elemento ripristinato");
  };
  return (
    <main className={`trip-modern ${editMode ? "edit-mode" : ""}`}>
      <header className="editorial-head trip-toolbar">
        <div>
          <p>IL NOSTRO VIAGGIO</p>
          <h1>
            Quindici giorni,
            <br />
            <span>una Sicilia.</span>
          </h1>
        </div>
        <button
          className={editMode ? "edit-toggle active" : "edit-toggle"}
          onClick={() => setEditMode((x) => !x)}
        >
          {editMode ? "✓ Fine" : "✎ Modifica viaggio"}
        </button>
      </header>
      <div className="day-ribbon">
        {trip.days.map((d) => (
          <button
            className={d.id === selected.id ? "active" : ""}
            onClick={() => setSelectedId(d.id)}
            key={d.id}
          >
            <small>DAY {d.dayNumber}</small>
            <strong>{new Date(`${d.date}T12:00`).getDate()}</strong>
            <em>
              {new Date(`${d.date}T12:00`).getMonth() === 7 ? "AGO" : "SET"}
            </em>
          </button>
        ))}
      </div>
      <header className="sticky-context">
        <span>DAY {selected.dayNumber}</span>
        <strong>{selected.title || "Programma da definire"}</strong>
        <em>{stopCount(selected)} tappe</em>
      </header>
      {editMode && (
        <div className="edit-mode-banner">
          <span>
            Trascina le tre linee a destra di una riga per
            cambiarne l'ordine.
          </span>

          <div className="edit-mode-actions">
            <button
              type="button"
              onClick={() =>
                setStopDraft({
                  name: "",
                  address: "",
                  city: selected.baseCity || "",
                  itemType: "poi",
                  notes: "",
                  coordinates: null,
                })
              }
            >
              + Tappa
            </button>

            <button
              type="button"
              onClick={() =>
                setRouteDraft({
                  origin: "",
                  originAddress: "",
                  originCoordinates: null,

                  destination: "",
                  destinationAddress: "",
                  destinationCoordinates: null,

                  mode: "car",
                  plannedDurationMinutes: "",
                  distanceKm: "",
})
              }
            >
              + Trasferimento
            </button>
          </div>
        </div>
      )}

      <DragDropContext
        onDragEnd={(result) => void boardDragEnd(result)}
      >
        <section className="trip-board-section itinerary-board-section">
          <div className="trip-board-heading">
            <div>
              <small>PROGRAMMA</small>
              <h2>Itinerario</h2>
            </div>
            <span>{selected.stops.length} tappe</span>
          </div>

          <SortableDroppable
            droppableId="itinerary"
            items={items}
            itemKey={(item) => `itinerary-${item.kind}-${item.id}`}
            disabled={!editMode}
            className="unified-timeline trip-board-list"
          >
        {(item, _index, { dragHandleProps }) => {
          if (item.kind === "route") {
            const route = item.route;
            return (
              <article
                className="transfer-card editable-transfer"
              >
                <span>
                  {route.mode === "walk"
                    ? "🚶"
                    : route.mode === "boat"
                      ? "⛵"
                      : "🚗"}
                </span>
                <div>
                  <small>TRASFERIMENTO</small>
                  <strong>
                    {route.origin} → {route.destination}
                  </strong>
                  <LiveRouteInfo route={route} />
                </div>

                <div className="route-row-actions">
                  <a
                    className="timeline-map-link"
                    href={routeMapsUrl(route)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Naviga verso ${route.destination} con Google Maps`}
                    title="Apri in Google Maps"
                  >
                    →
                  </a>

                  {editMode && (
                    <div className="timeline-controls">
                      <button
                        type="button"
                        className="route-edit-button"
                        aria-label="Modifica trasferimento"
                        onClick={() =>
                          setRouteDraft({
                            id: route.id,

                            origin: route.origin,
                            originAddress: route.originAddress || "",
                            originCoordinates:
                              route.originCoordinates || null,

                            destination: route.destination,
                            destinationAddress:
                              route.destinationAddress || "",
                            destinationCoordinates:
                              route.destinationCoordinates || null,

                            mode: route.mode || "car",

                            plannedDurationMinutes:
                              route.plannedDurationMinutes?.toString() || "",

                            distanceKm:
                              route.distanceKm?.toString() || "",
                          })
                        }
                      >
                        ✎
                      </button>

                      <button
                        type="button"
                        className="route-delete-button"
                        aria-label="Elimina trasferimento"
                        onClick={() => setConfirmDelete(item)}
                      >
                        ×
                      </button>

                      <button
                        type="button"
                        className="drag-handle route-drag-handle"
                        aria-label={`Trascina trasferimento da ${route.origin} a ${route.destination}`}
                        title="Trascina per riordinare"
                        {...dragHandleProps}
                      >
                        <span />
                        <span />
                        <span />
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          }
          const stop = item.stop;

          return (
            <div
              className="timeline-stop-wrap"
              key={`stop-${stop.id}`}
            >
              <StopRow
                stop={stop}
                editMode={editMode}
                menu={menu === `stop-${stop.id}`}
                onMenu={() =>
                  setMenu(
                    menu === `stop-${stop.id}`
                      ? null
                      : `stop-${stop.id}`,
                  )
                }
                onOpen={() => {
                  setMenu(null);
                  setActive(asTripStop(stop));
                }}
                onEdit={() => {
                  setMenu(null);
                  setStopDraft({
                    id: stop.id,
                    name: stop.name,
                    address: stop.address || "",
                    city: stop.city,
                    itemType: stop.itemType,
                    notes: stop.notes || "",
                    startTime: stop.startTime ?? undefined,
                    endTime: stop.endTime ?? undefined,
                    coordinates: stop.coordinates,
                  });
                }}
                onStatus={(value) => {
                  setMenu(null);
                  void status(asTripStop(stop), value);
                }}
                onDelete={() => {
                  setMenu(null);
                  setConfirmDelete(item);
                }}
                dragHandleProps={dragHandleProps}
              />
            </div>
          );
        }}
      </SortableDroppable>


      {nextDayTransfer && (
              <article className="transfer-card editable-transfer">
                <span>
                  {nextDayTransfer.mode === "walk"
                    ? <>&#128694;</>
                    : nextDayTransfer.mode === "boat"
                      ? <>&#9973;</>
                      : <>&#128663;</>}
                </span>

                <div>
                  <small>TRASFERIMENTO</small>

                  <strong>
                    {nextDayTransfer.origin}
                    {" "}
                    {'\u2192'}
                    {" "}
                    {nextDayTransfer.destination}
                  </strong>

                  <LiveRouteInfo route={nextDayTransfer} />
                </div>

                <div className="route-row-actions">
                  <a
                    className="timeline-map-link"
                    href={routeMapsUrl(nextDayTransfer)}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Naviga verso ${nextDayTransfer.destination} con Google Maps`}
                    title="Apri in Google Maps"
                  >
                    &#8594;
                  </a>

                  {editMode && (
                    <button
                      type="button"
                      className="route-edit-button"
                      aria-label="Modifica trasferimento inter-day"
                      title="Modifica trasferimento"
                      onClick={() =>
                        setRouteDraft({
                          origin: nextDayTransfer.origin,
                          originAddress: nextDayTransfer.originAddress || "",
                          originCoordinates:
                            nextDayTransfer.originCoordinates || null,

                          destination: nextDayTransfer.destination,
                          destinationAddress:
                            nextDayTransfer.destinationAddress || "",
                          destinationCoordinates:
                            nextDayTransfer.destinationCoordinates || null,

                          mode: nextDayTransfer.mode || "car",
                          plannedDurationMinutes:
                            nextDayTransfer.plannedDurationMinutes?.toString() || "",
                          distanceKm:
                            nextDayTransfer.distanceKm?.toString() || "",
                        })
                      }
                    >
                      &#9998;
                    </button>
                  )}
                </div>
              </article>
            )}
</section>

      <section className="trip-board-section optional-board-section">
        <div className="trip-board-heading">
          <div>
            <small>EXTRA</small>
            <h2>Tappe aggiuntive</h2>
          </div>
          <span>
            {optionalPlaces.length}{" "}
            {optionalPlaces.length === 1 ? "Tappa" : "Tappe"}
          </span>
        </div>

        <SortableDroppable
          droppableId="optional"
          items={optionalPlaces}
          itemKey={(place) => `optional-${place.id}`}
          disabled={!editMode}
          className="trip-board-list saved-board-list"
        >
          {(place, _index, { dragHandleProps }) => {
          const savedStop = savedPlaceAsTripStop(
            place,
            "Tappa Aggiuntiva",
          );

          const openSavedPlace = () => {
            setMenu(null);
            setActive(savedStop);
          };

          return (
            <article className="editable-stop saved-place-stop planned">
              <div className="stop-status-wrap">
                <button
                  type="button"
                  className="stop-status-button planned"
                  aria-label={`Apri ${place.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openSavedPlace();
                  }}
                >
                  <span className="stop-status-core" />
                </button>
              </div>

              <time className="saved-place-time">&mdash;</time>

              <button
                type="button"
                className="stop-content saved-place-content"
                onClick={openSavedPlace}
              >
                <strong>{place.name}</strong>

                <small>Tappa Aggiuntiva</small>

                {place.address && (
                  <em>{place.address}</em>
                )}
              </button>

              <a
                className="timeline-map-link"
                href={savedMapsUrl(place)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Apri ${place.name} in Google Maps`}
                title="Apri in Google Maps"
                onClick={(event) => event.stopPropagation()}
              >
                &#8594;
              </a>

              {editMode && (
                <button
                  type="button"
                  className="drag-handle"
                  aria-label={`Trascina ${place.name}`}
                  title="Trascina per riordinare"
                  {...dragHandleProps}
                >
                  <span />
                  <span />
                  <span />
                </button>
              )}
            </article>
          );
        }}
            </SortableDroppable>
</section>

      <section className="trip-board-section food-board-section">
        <div className="trip-board-heading">
          <div>
            <small>MANGIARE</small>
            <h2>Food consigliato</h2>
          </div>
          <span>
            {foodPlaces.length}{" "}
            {foodPlaces.length === 1 ? "Tappa" : "Tappe"}
          </span>
        </div>

        <SortableDroppable
          droppableId="food"
          items={foodPlaces}
          itemKey={(place) => `food-${place.id}`}
          disabled={!editMode}
          className="trip-board-list saved-board-list"
        >
          {(place, _index, { dragHandleProps }) => {
          const savedStop = savedPlaceAsTripStop(
            place,
            "Food Consigliato",
          );

          const openSavedPlace = () => {
            setMenu(null);
            setActive(savedStop);
          };

          return (
            <article className="editable-stop saved-place-stop planned">
              <div className="stop-status-wrap">
                <button
                  type="button"
                  className="stop-status-button planned"
                  aria-label={`Apri ${place.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    openSavedPlace();
                  }}
                >
                  <span className="stop-status-core" />
                </button>
              </div>

              <time className="saved-place-time">&mdash;</time>

              <button
                type="button"
                className="stop-content saved-place-content"
                onClick={openSavedPlace}
              >
                <strong>{place.name}</strong>

                <small>Food Consigliato</small>

                {place.address && (
                  <em>{place.address}</em>
                )}
              </button>

              <a
                className="timeline-map-link"
                href={savedMapsUrl(place)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Apri ${place.name} in Google Maps`}
                title="Apri in Google Maps"
                onClick={(event) => event.stopPropagation()}
              >
                &#8594;
              </a>

              {editMode && (
                <button
                  type="button"
                  className="drag-handle"
                  aria-label={`Trascina ${place.name}`}
                  title="Trascina per riordinare"
                  {...dragHandleProps}
                >
                  <span />
                  <span />
                  <span />
                </button>
              )}
            </article>
          );
        }}
      </SortableDroppable>
      </section>
      </DragDropContext>

      {!items.length && (
          <section className="empty-day">
            <span>○</span>
            <h2>Tempo libero</h2>
            <p>Nessuna attività assegnata.</p>
            {editMode && (
              <button
                className="pip-primary"
                onClick={() =>
                  setStopDraft({
                    name: "",
                    address: "",
                    city: selected.baseCity || selected.title || "",
                    itemType: "poi",
                    notes: "",
                    coordinates: null,
                  })
                }
              >
                + Aggiungi tappa
              </button>
            )}
          </section>
      )}
      {editMode && (
        <button className="reset-trip" onClick={() => setConfirmReset(true)}>
          Ripristina itinerario originale
        </button>
      )}
      <StopSheet
        stop={active}
        onClose={() => setActive(null)}
        onStatus={(value) => active && void status(active, value)}
        onGuide={onGuide}
        onEdit={
          active?.backendId
            ? () => {
                const stop = selected.stops.find(
                  (s) => s.id === active.backendId,
                );
                if (stop) {
                  setActive(null);
                  setStopDraft({
                    id: stop.id,
                    name: stop.name,
                    address: stop.address || "",
                    city: stop.city,
                    itemType: stop.itemType,
                    notes: stop.notes || "",
                    startTime: stop.startTime ?? undefined,
                    endTime: stop.endTime ?? undefined,
                    coordinates: stop.coordinates,
                  });
                }
              }
            : undefined
        }
      />
      <BottomSheet
        open={!!pendingPromotion}
        title="Aggiungi all'itinerario"
        onClose={() => {
          setPendingPromotion(null);
          setPromotionTime("");
        }}
      >
        <div className="trip-promotion-dialog">
          <p>
            {pendingPromotion
              ? `A che ora vuoi inserire "${pendingPromotion.place.name}"?`
              : ""}
          </p>

          <label>
            Orario
            <input
              type="time"
              value={promotionTime}
              onChange={(event) =>
                setPromotionTime(event.target.value)
              }
              required
            />
          </label>

          <div className="saved-editor-actions">
            <button
              type="button"
              onClick={() => {
                setPendingPromotion(null);
                setPromotionTime("");
              }}
            >
              Annulla
            </button>

            <button
              type="button"
              className="pip-primary"
              disabled={!promotionTime}
              onClick={() => void confirmPromotion()}
            >
              Aggiungi all'itinerario
            </button>
          </div>
        </div>
      </BottomSheet>

      <StopEditor
        open={!!stopDraft}
        draft={stopDraft}
        dayId={selected.id}
        onClose={() => setStopDraft(null)}
        onSaved={() => {
          onChanged();
          flash("Tappa salvata");
        }}
      />
      <RouteEditor
        open={!!routeDraft}
        draft={routeDraft}
        dayId={selected.id}
        onClose={() => setRouteDraft(null)}
        onSaved={() => {
          onChanged();
          flash("Trasferimento salvato");
        }}
      />
      <ConfirmDialog
        open={!!confirmDelete}
        title={`Eliminare ${confirmDelete?.kind === "route" ? "il trasferimento" : "la tappa"}?`}
        text="L’elemento verrà archiviato e potrai annullare subito l’operazione."
        onCancel={() => setConfirmDelete(null)}
        onConfirm={() => void remove()}
        danger
      />
      <ConfirmDialog
        open={confirmReset}
        title="Ripristinare il piano originale?"
        text="Tutte le personalizzazioni di tappe, indirizzi e ordine saranno sostituite dal piano importato dal PDF."
        onCancel={() => setConfirmReset(false)}
        onConfirm={async () => {
          await api("/api/trip/reset-original", { method: "POST" });
          setConfirmReset(false);
          setEditMode(false);
          onChanged();
          flash("Itinerario originale ripristinato");
        }}
        danger
      />
      <Toast
        message={toast}
        action={undo ? "ANNULLA" : undefined}
        onAction={() => void undoDelete()}
      />
    </main>
  );
}

export function GuideView({ trip, initial, onChanged }: { trip: Trip; initial?: string; onChanged?:()=>void }) {
  const baseGuides = useMemo(
    () => guidesFromDays(trip.days),
    [trip],
  );

  const [savedGuidePlaces, setSavedGuidePlaces] =
    useState<SavedPlace[]>([]);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Guide | null>(null);
  const [poi, setPoi] = useState<TripStop | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;

    api<SavedPlace[]>("/api/saved")
      .then((places) => {
        if (active) {
          setSavedGuidePlaces(places);
        }
      })
      .catch(() => {
        if (active) {
          setSavedGuidePlaces([]);
        }
      });

    return () => {
      active = false;
    };
  }, [version]);

  const normalizeSavedGuideLocation = (value: string) =>
    value
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u2019']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const savedGuideCity = (place: SavedPlace) => {
    const day = trip.days.find(
      (candidate) => candidate.id === place.trip_day_id,
    );

    const searchable = normalizeSavedGuideLocation(
      `${place.name} ${place.address || ""}`,
    );

    const cities = Array.from(
      new Set(
        trip.days.flatMap((tripDay) => [
          tripDay.baseCity,
          tripDay.title,
          ...(tripDay.stops || []).map((stop) => stop.city),
        ]),
      ),
    ).filter((value): value is string => Boolean(value));

    const match = [...cities]
      .sort((a, b) => b.length - a.length)
      .find((city) =>
        searchable.includes(
          normalizeSavedGuideLocation(city),
        ),
      );

    return (
      match ||
      day?.baseCity ||
      day?.stops?.[0]?.city ||
      day?.title ||
      "Sicilia"
    );
  };

  const savedGuideStop = (place: SavedPlace): TripStop => {
    const city = savedGuideCity(place);

    return {
      id: poiIdentity(place.name, city),
      key: `saved-${place.id}`,
      name: place.name,
      city,
      kind: "poi",
      address: place.address || undefined,
      notes:
        place.notes ||
        (place.category === "food"
          ? "Food consigliato"
          : "Tappa aggiuntiva"),
      coordinates:
        place.latitude != null &&
        place.longitude != null
          ? {
              lat: place.latitude,
              lon: place.longitude,
            }
          : null,
      status: "planned",
      sourceIndex: 0,
      sortOrder: place.sort_order ?? 0,
      original: false,
    };
  };

  const savedStops = savedGuidePlaces.map(savedGuideStop);

  const guides = useMemo(() => {
    return baseGuides.map((guide) => {
      const guideName =
        normalizeSavedGuideLocation(guide.title);

      const extras = savedStops.filter((stop) => {
        const stopCity =
          normalizeSavedGuideLocation(stop.city);

        return (
          stopCity === guideName ||
          stopCity.includes(guideName) ||
          guideName.includes(stopCity)
        );
      });

      const existing = new Set(
        guide.stops.map((stop) => stop.id),
      );

      return {
        ...guide,
        stops: [
          ...guide.stops,
          ...extras.filter(
            (stop) => !existing.has(stop.id),
          ),
        ],
      };
    });
  }, [baseGuides, savedGuidePlaces]);

  const allStops = useMemo(() => {
    const result = guides.flatMap(
      (guide) => guide.stops,
    );

    const existing = new Set(
      result.map((stop) => stop.id),
    );

    for (const stop of savedStops) {
      if (!existing.has(stop.id)) {
        result.push(stop);
      }
    }

    return result;
  }, [guides, savedGuidePlaces]);
  useEffect(() => {
    if (initial) {
      const q = initial.toLowerCase();
      setSelected(
        guides.find((g) => g.title.toLowerCase().includes(q)) || null,
      );
    }
  }, [initial, guides]);
  const guideResults = guides.filter((g) =>
    `${g.title} ${g.stops.map((s) => s.name).join(" ")}`
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const poiResults = query
    ? allStops.filter((s) => s.name.toLowerCase().includes(query.toLowerCase()))
    : [];
  const updatePoiStatus=async(next:StopStatus)=>{if(!poi)return;if(poi.backendId)await api(`/api/stops/${poi.backendId}`,{method:"PATCH",body:JSON.stringify({status:next==="done"?"completed":next})});writeStopStatus(poi.id,next);setPoi(null);setVersion(x=>x+1);onChanged?.()};
  if (selected) {
    const city = cityGuideContent[selected.slug];
    return (
      <main className="guide-detail">
        <button className="back-link" onClick={() => setSelected(null)}>
          ← Tutte le guide
        </button>
        <header className="guide-hero">
          <small>GUIDA LOCALE</small>
          <h1>{selected.title}</h1>
          <p>{city?.subtitle || selected.subtitle}</p>
        </header>
        {city ? (
          <div className="city-editorial">
            <section>
              <small>INTRODUZIONE</small>
              <p>{city.introduction}</p>
            </section>
            <section>
              <small>STORIA IN BREVE</small>
              <p>{city.history}</p>
            </section>
            <section className="fact-card">
              <small>COSA LA RENDE SPECIALE</small>
              <p>{city.special}</p>
            </section>
            <section className="food-guide">
              <small>COSA ASSAGGIARE</small>
              <p>{city.food}</p>
              {city.foodSpecialties?.map((item) => (
                <article key={item.name}>
                  <span>{item.icon}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <p>{item.description}</p>
                  </div>
                </article>
              ))}
            </section>
            <section className="local-tip">
              <small>CONSIGLIO PIP &amp; PIP</small>
              <p>{city.localTip || city.tips}</p>
            </section>
            <a
              className="source-link"
              href={city.sourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              Fonte: {city.sourceLabel} ↗
            </a>
          </div>
        ) : (
          <section className="guide-copy">
            <h2>Panoramica</h2>
            <p>{selected.overview}</p>
          </section>
        )}
        <section className="guide-places">
          <div>
            <small>I TUOI LUOGHI</small>
            <h2>{selected.stops.length} tappe</h2>
          </div>
          {selected.stops.map((s) => (
            <button
              className="guide-place-row"
              key={s.id}
              onClick={() => setPoi(s)}
            >
              <span>{s.kind === "experience" ? "✦" : "○"}</span>
              <div>
                <strong>{s.name}</strong>
                <small>
                  {"Guida completa"}
                </small>
              </div>
              <b>→</b>
            </button>
          ))}
        </section>
        <StopSheet
          stop={poi}
          onClose={() => setPoi(null)}
          onStatus={(status) => void updatePoiStatus(status)}
          onGuide={() => {}}
        />
      </main>
    );
  }
  return (
    <main className="guide-index" key={version}>
      <header className="editorial-head">
        <p>GUIDA DI VIAGGIO</p>
        <h1>
          Cosa vuoi
          <br />
          <span>scoprire?</span>
        </h1>
      </header>
      <label className="guide-search">
        <span>⌕</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Cerca città o luogo"
        />
      </label>
      {poiResults.length > 0 && (
        <section className="search-results">
          <small>LUOGHI</small>
          {poiResults.map((s) => (
            <button key={s.id} onClick={() => setPoi(s)}>
              <span>
                <strong>{s.name}</strong>
                <em>{s.city}</em>
              </span>
              <b>→</b>
            </button>
          ))}
        </section>
      )}
      <h2 className="guide-section-title">Nel tuo viaggio</h2>
      <div className="guide-grid">
        {guideResults.map((g, i) => (
          <button key={g.slug} onClick={() => setSelected(g)}>
            <small>{String(i + 1).padStart(2, "0")}</small>
            <strong>{g.title}</strong>
            <span>{g.stops.length} luoghi →</span>
          </button>
        ))}
      </div>
      <StopSheet
        stop={poi}
        onClose={() => setPoi(null)}
        onStatus={(status) => void updatePoiStatus(status)}
        onGuide={(city) =>
          setSelected(guides.find((g) => g.title === city) || null)
        }
      />
    </main>
  );
}
