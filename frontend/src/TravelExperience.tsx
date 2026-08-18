import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ItineraryStop, Trip, TripDay, TripRoute } from "./types";
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
import { SortableTimeline, type SortableRenderState } from "./SortableTimeline";

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
function Editorial({ content }: { content: PoiGuideContent }) {
  return (
    <div className="poi-editorial">
      <p className="guide-lead">{content.shortIntro}</p>
      <p>{content.description}</p>
      {content.whyVisit && (
        <section>
          <small>PERCHÉ VISITARLO</small>
          <p>{content.whyVisit}</p>
        </section>
      )}
      {content.history && (
        <section>
          <small>STORIA</small>
          <p>{content.history}</p>
        </section>
      )}
      {content.whatToSee && (
        <section className="fact-card">
          <small>DA GUARDARE</small>
          <p>{content.whatToSee}</p>
        </section>
      )}
      {content.curiosities && (
        <section>
          <small>LO SAPEVI?</small>
          <p>{content.curiosities}</p>
        </section>
      )}
      {content.practicalTips && (
        <section>
          <small>CONSIGLIO PIP &amp; PIP</small>
          <p>{content.practicalTips}</p>
        </section>
      )}
      <a
        className="source-link"
        href={content.sourceUrl}
        target="_blank"
        rel="noreferrer"
      >
        Fonte: {content.sourceLabel} ↗
      </a>
    </div>
  );
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
  const content = stop ? poiGuideContent[stop.id] : null;
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
            <button onClick={() => onStatus("done")}>
              ✓ Segna come visitato
            </button>
            <button onClick={() => onStatus("skipped")}>
              Salta questa tappa
            </button>
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
type Candidate = {
  displayName: string;
  coordinates: { lat: number; lon: number };
  type?: string;
};
type StopDraft = {
  id?: number;
  name: string;
  address: string;
  city: string;
  itemType: string;
  notes: string;
  coordinates: { lat: number; lon: number } | null;
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
  const [value, setValue] = useState<StopDraft | null>(draft),
    [initial, setInitial] = useState(""),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [chosen, setChosen] = useState<Candidate | null>(null),
    [confirmed, setConfirmed] = useState(false),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [discard, setDiscard] = useState(false);
  useEffect(() => {
    setValue(draft);
    setInitial(JSON.stringify(draft));
    setCandidates([]);
    setChosen(null);
    setConfirmed(false);
    setError("");
  }, [draft]);
  if (!value) return null;
  const dirty = JSON.stringify(value) !== initial || confirmed;
  const close = () => (dirty ? setDiscard(true) : onClose());
  const verify = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await api<{ candidates: Candidate[] }>(
        `/api/geocode/preview?q=${encodeURIComponent(value.address)}`,
      );
      setCandidates(result.candidates);
      if (!result.candidates.length)
        setError(
          "Posizione non verificata: puoi comunque salvare l’indirizzo.",
        );
    } catch {
      setError(
        "Posizione non verificata: servizio momentaneamente non disponibile.",
      );
    } finally {
      setLoading(false);
    }
  };
  const save = async () => {
    setLoading(true);
    const body = {
      name: value.name,
      city: value.city,
      item_type: value.itemType,
      address: value.address || null,
      notes: value.notes || null,
      ...(confirmed && chosen ? { coordinates: chosen.coordinates } : {}),
    };
    try {
      if (value.id)
        await api(`/api/stops/${value.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      else
        await api(`/api/trip/${dayId}/stops`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      onSaved();
      onClose();
    } catch {
      setError("Salvataggio non riuscito. Riprova.");
    } finally {
      setLoading(false);
    }
  };
  return (
    <>
      <BottomSheet
        open={open}
        title={value.id ? "Modifica tappa" : "Aggiungi tappa"}
        onClose={close}
        expanded
      >
        <form
          className="modern-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Nome
            <input
              required
              value={value.name}
              onChange={(e) => setValue({ ...value, name: e.target.value })}
            />
          </label>
          <label>
            Indirizzo
            <input
              value={value.address}
              onChange={(e) => {
                setValue({ ...value, address: e.target.value });
                setCandidates([]);
                setChosen(null);
                setConfirmed(false);
              }}
              placeholder="Via, città, provincia, Italia"
            />
          </label>
          <button
            className="verify-map"
            type="button"
            disabled={loading || value.address.length < 3}
            onClick={() => void verify()}
          >
            {loading ? "Verifica…" : "⌖ Verifica sulla mappa"}
          </button>
          {error && <p className="editor-warning">{error}</p>}
          {candidates.length > 0 && (
            <div className="geocode-candidates">
              <small>
                {candidates.length > 1
                  ? "SCEGLI IL RISULTATO CORRETTO"
                  : "RISULTATO TROVATO"}
              </small>
              {candidates.map((item) => (
                <button
                  type="button"
                  className={chosen === item ? "selected" : ""}
                  onClick={() => {
                    setChosen(item);
                    setConfirmed(false);
                  }}
                  key={`${item.coordinates.lat}-${item.coordinates.lon}`}
                >
                  <span>⌖</span>
                  {item.displayName}
                </button>
              ))}
              {chosen && !confirmed && (
                <button
                  className="confirm-position"
                  type="button"
                  onClick={() => setConfirmed(true)}
                >
                  Conferma questa posizione
                </button>
              )}
              {confirmed && (
                <p className="position-ok">
                  ✓ Coordinate pronte per il salvataggio
                </p>
              )}
            </div>
          )}
          <div className="editor-grid">
            <label>
              Città / area
              <input
                required
                value={value.city}
                onChange={(e) => setValue({ ...value, city: e.target.value })}
              />
            </label>
            <label>
              Tipo
              <select
                value={value.itemType}
                onChange={(e) =>
                  setValue({ ...value, itemType: e.target.value })
                }
              >
                <option value="poi">POI</option>
                <option value="experience">Esperienza</option>
                <option value="food">Food</option>
                <option value="nature">Natura</option>
              </select>
            </label>
          </div>
          <label>
            Note
            <textarea
              value={value.notes}
              onChange={(e) => setValue({ ...value, notes: e.target.value })}
            />
          </label>
          <button className="pip-primary save-editor" disabled={loading}>
            Salva modifiche
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
  destination: string;
  destinationAddress: string;
  mode: string;
  plannedDurationMinutes: string;
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
  const [value, setValue] = useState<RouteDraft | null>(draft),
    [initial, setInitial] = useState(""),
    [discard, setDiscard] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setValue(draft);
    setInitial(JSON.stringify(draft));
    setError("");
  }, [draft]);
  if (!value) return null;
  const close = () =>
    JSON.stringify(value) !== initial ? setDiscard(true) : onClose();
  const save = async () => {
    const body = {
      origin: value.origin,
      origin_address: value.originAddress || null,
      destination: value.destination,
      destination_address: value.destinationAddress || null,
      mode: value.mode,
      planned_duration_minutes: value.plannedDurationMinutes
        ? Number(value.plannedDurationMinutes)
        : null,
    };
    try {
      if (value.id)
        await api(`/api/routes/item/${value.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      else
        await api(`/api/trip/${dayId}/routes`, {
          method: "POST",
          body: JSON.stringify(body),
        });
      onSaved();
      onClose();
    } catch {
      setError("Salvataggio non riuscito.");
    }
  };
  return (
    <>
      <BottomSheet
        open={open}
        title={value.id ? "Modifica trasferimento" : "Nuovo trasferimento"}
        onClose={close}
        expanded
      >
        <form
          className="modern-editor"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label>
            Partenza
            <input
              required
              value={value.origin}
              onChange={(e) => setValue({ ...value, origin: e.target.value })}
            />
          </label>
          <label>
            Indirizzo partenza
            <input
              value={value.originAddress}
              onChange={(e) =>
                setValue({ ...value, originAddress: e.target.value })
              }
            />
          </label>
          <label>
            Destinazione
            <input
              required
              value={value.destination}
              onChange={(e) =>
                setValue({ ...value, destination: e.target.value })
              }
            />
          </label>
          <label>
            Indirizzo destinazione
            <input
              value={value.destinationAddress}
              onChange={(e) =>
                setValue({ ...value, destinationAddress: e.target.value })
              }
            />
          </label>
          <div className="editor-grid">
            <label>
              Tipo
              <select
                value={value.mode}
                onChange={(e) => setValue({ ...value, mode: e.target.value })}
              >
                <option value="car">Auto</option>
                <option value="walk">A piedi</option>
                <option value="boat">Barca</option>
                <option value="other">Altro</option>
              </select>
            </label>
            <label>
              Durata prevista
              <input
                type="number"
                min="1"
                inputMode="numeric"
                value={value.plannedDurationMinutes}
                onChange={(e) =>
                  setValue({ ...value, plannedDurationMinutes: e.target.value })
                }
              />
            </label>
          </div>
          {error && <p className="editor-warning">{error}</p>}
          <button className="pip-primary save-editor">
            Salva trasferimento
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

function StopRow({
  stop,
  editMode,
  menu,
  onMenu,
  onOpen,
  onEdit,
  onStatus,
  onDelete,
  onMove,
  dragHandleProps,
}: {
  stop: ItineraryStop;
  editMode: boolean;
  menu: boolean;
  onMenu: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onStatus: (status: string) => void;
  onDelete: () => void;
  onMove: (direction: -1 | 1) => void;
  dragHandleProps: SortableRenderState["dragHandleProps"];
}) {
  const value = asTripStop(stop);
  return (
    <article className={`editable-stop ${stop.status}`}>
      {editMode && (
        <button
          type="button"
          className="drag-handle"
          aria-label={`Trascina ${stop.name}`}
          {...dragHandleProps}
        >
          ☰
        </button>
      )}
      <button className="stop-main" onClick={onOpen}>
        <i />
        <span>
          <strong>{stop.name}</strong>
          <small>
            {stop.address ||
              `${stop.itemType === "experience" ? "Esperienza" : "Tappa"} · ${stop.city}`}
          </small>
        </span>
      </button>
      <button
        className="more-button"
        aria-label={`Azioni per ${stop.name}`}
        onClick={onMenu}
      >
        ⋯
      </button>
      {menu && (
        <div className="context-menu">
          <button onClick={onEdit}>Modifica</button>
          <a href={maps(value, "search")} target="_blank" rel="noreferrer">
            Mostra sulla mappa
          </a>
          <a href={maps(value)} target="_blank" rel="noreferrer">
            Naviga
          </a>
          <button onClick={() => onStatus("completed")}>
            Segna come visitato
          </button>
          <button onClick={() => onStatus("skipped")}>Salta</button>
          {editMode && (
            <>
              <button onClick={() => onMove(-1)}>Sposta su</button>
              <button onClick={() => onMove(1)}>Sposta giù</button>
              <button className="danger-text" onClick={onDelete}>
                Elimina
              </button>
            </>
          )}
        </div>
      )}
    </article>
  );
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
    [confirmReset, setConfirmReset] = useState(false);
  const selected = trip.days.find((d) => d.id === selectedId) || trip.days[0],
    items = useMemo(() => timeline(selected), [selected]);
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
  const move = (kind: "stop" | "route", id: number, direction: -1 | 1) => {
    const index = items.findIndex(
        (item) => item.kind === kind && item.id === id,
      ),
      target = index + direction;
    if (index < 0 || target < 0 || target >= items.length) return;
    const next = [...items];
    [next[index], next[target]] = [next[target], next[index]];
    void reorder(next);
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
    flash(value === "done" ? "Tappa completata" : "Tappa saltata");
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
  let previousCity = "";
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
          <span>☰ Trascina oppure usa Sposta su/giù</span>
          <button
            onClick={() =>
              setRouteDraft({
                origin: "",
                originAddress: "",
                destination: "",
                destinationAddress: "",
                mode: "car",
                plannedDurationMinutes: "",
              })
            }
          >
            + Trasferimento
          </button>
        </div>
      )}
      <SortableTimeline
        items={items}
        itemKey={(item) => `${item.kind}-${item.id}`}
        disabled={!editMode}
        onReorder={(next) => void reorder(next)}
      >
        {(item, index, { dragHandleProps }) => {
          if (item.kind === "route") {
            previousCity = "";
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
                  <p>
                    {route.plannedDurationMinutes
                      ? `${route.plannedDurationMinutes} min`
                      : "Durata da calcolare"}
                  </p>
                  {route.destinationAddress && (
                    <em>{route.destinationAddress}</em>
                  )}
                </div>
                {editMode && (
                  <div className="timeline-controls">
                    <button
                      type="button"
                      className="drag-handle"
                      aria-label={`Trascina trasferimento da ${route.origin} a ${route.destination}`}
                      {...dragHandleProps}
                    >
                      ☰
                    </button>
                    <button
                      onClick={() =>
                        setRouteDraft({
                          id: route.id,
                          origin: route.origin,
                          originAddress: route.originAddress || "",
                          destination: route.destination,
                          destinationAddress: route.destinationAddress || "",
                          mode: route.mode || "car",
                          plannedDurationMinutes:
                            route.plannedDurationMinutes?.toString() || "",
                        })
                      }
                    >
                      ✎
                    </button>
                    <button onClick={() => move("route", route.id, -1)}>
                      ↑
                    </button>
                    <button onClick={() => move("route", route.id, 1)}>
                      ↓
                    </button>
                    <button onClick={() => setConfirmDelete(item)}>×</button>
                  </div>
                )}
              </article>
            );
          }
          const stop = item.stop,
            showCity = stop.city !== previousCity;
          previousCity = stop.city;
          const next = items[index + 1],
            endCity =
              !next ||
              next.kind === "route" ||
              (next.kind === "stop" && next.stop.city !== stop.city);
          return (
            <div className="timeline-stop-wrap" key={`stop-${stop.id}`}>
              {showCity && (
                <header className="timeline-city">
                  <small>LOCATION</small>
                  <strong>{stop.city}</strong>
                  <button onClick={() => onGuide(stop.city)}>Guida →</button>
                </header>
              )}
              <StopRow
                stop={stop}
                editMode={editMode}
                menu={menu === `stop-${stop.id}`}
                onMenu={() =>
                  setMenu(menu === `stop-${stop.id}` ? null : `stop-${stop.id}`)
                }
                onOpen={() => setActive(asTripStop(stop))}
                onEdit={() => {
                  setMenu(null);
                  setStopDraft({
                    id: stop.id,
                    name: stop.name,
                    address: stop.address || "",
                    city: stop.city,
                    itemType: stop.itemType,
                    notes: stop.notes || "",
                    coordinates: stop.coordinates,
                  });
                }}
                onStatus={(value) => {
                  setMenu(null);
                  void status(
                    asTripStop(stop),
                    value === "completed" ? "done" : "skipped",
                  );
                }}
                onDelete={() => {
                  setMenu(null);
                  setConfirmDelete(item);
                }}
                onMove={(direction) => move("stop", stop.id, direction)}
                dragHandleProps={dragHandleProps}
              />
              {editMode && endCity && (
                <button
                  className="add-stop-inline"
                  onClick={() =>
                    setStopDraft({
                      name: "",
                      address: "",
                      city: stop.city,
                      itemType: "poi",
                      notes: "",
                      coordinates: null,
                    })
                  }
                >
                  + Aggiungi tappa a {stop.city}
                </button>
              )}
            </div>
          );
        }}
      </SortableTimeline>
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
                    coordinates: stop.coordinates,
                  });
                }
              }
            : undefined
        }
      />
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

export function GuideView({ trip, initial }: { trip: Trip; initial?: string }) {
  const guides = useMemo(() => guidesFromDays(trip.days), [trip]),
    allStops = useMemo(() => guides.flatMap((g) => g.stops), [guides]);
  const [query, setQuery] = useState(""),
    [selected, setSelected] = useState<Guide | null>(null),
    [poi, setPoi] = useState<TripStop | null>(null),
    [version, setVersion] = useState(0);
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
                  {poiGuideContent[s.id]
                    ? "Guida completa"
                    : "Scheda itinerario"}
                </small>
              </div>
              <b>→</b>
            </button>
          ))}
        </section>
        <StopSheet
          stop={poi}
          onClose={() => setPoi(null)}
          onStatus={(status) => {
            if (poi) {
              writeStopStatus(poi.id, status);
              setPoi(null);
              setVersion((x) => x + 1);
            }
          }}
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
        onStatus={(status) => {
          if (poi) {
            writeStopStatus(poi.id, status);
            setPoi(null);
          }
        }}
        onGuide={(city) =>
          setSelected(guides.find((g) => g.title === city) || null)
        }
      />
    </main>
  );
}
