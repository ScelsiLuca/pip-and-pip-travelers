import { useEffect, useState } from "react";
import { api } from "./api";
import type { Coordinates } from "./types";

export type SavedPlace = {
  id: number;
  name: string;
  category: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  notes?: string | null;
  link?: string | null;
};

type PlaceForm = {
  id?: number;
  name: string;
  category: string;
  address: string;
  latitude: string;
  longitude: string;
  notes: string;
};

const EMPTY_FORM: PlaceForm = {
  name: "",
  category: "",
  address: "",
  latitude: "",
  longitude: "",
  notes: "",
};

function distanceKm(from: Coordinates, to: { lat: number; lon: number }) {
  const earthRadiusKm = 6371;
  const toRad = (value: number) => (value * Math.PI) / 180;

  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);
  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) *
      Math.cos(lat2) *
      Math.sin(dLon / 2) ** 2;

  return (
    earthRadiusKm *
    2 *
    Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  );
}

function placeDistance(
  place: SavedPlace,
  position?: Coordinates | null
) {
  if (
    !position ||
    place.latitude == null ||
    place.longitude == null
  ) {
    return null;
  }

  return distanceKm(position, {
    lat: place.latitude,
    lon: place.longitude,
  });
}

function formatDistance(km: number) {
  if (km < 1) {
    return `${Math.round(km * 1000)} m`;
  }

  return `${km.toFixed(1).replace(".", ",")} km`;
}

function mapsUrl(place: SavedPlace) {
  if (place.latitude != null && place.longitude != null) {
    return `https://www.google.com/maps/dir/?api=1&destination=${place.latitude},${place.longitude}`;
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${place.name} ${place.address || ""}`
  )}`;
}

function SavedPlacesSection({
  location,
  position,
  food,
}: {
  location: string;
  position?: Coordinates | null;
  food: boolean;
}) {
  const [places, setPlaces] = useState<SavedPlace[] | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editing, setEditing] = useState<PlaceForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    api<SavedPlace[]>("/api/saved")
      .then((all) => {
        if (!active) return;

        const locationLower = location.toLowerCase();

        const filtered = all
          .filter((place) =>
            food
              ? place.category === "food"
              : place.category !== "food"
          )
          .filter(
            (place) =>
              place.address
                ?.toLowerCase()
                .includes(locationLower) ||
              place.name
                .toLowerCase()
                .includes(locationLower)
          )
          .sort((a, b) => {
            const distanceA = placeDistance(a, position);
            const distanceB = placeDistance(b, position);

            if (distanceA == null && distanceB == null) return 0;
            if (distanceA == null) return 1;
            if (distanceB == null) return -1;

            return distanceA - distanceB;
          });

        setPlaces(filtered);
      })
      .catch(() => {
        if (active) setPlaces([]);
      });

    return () => {
      active = false;
    };
  }, [location, position, food, refreshKey]);

  const startAdd = () => {
    setError("");
    setEditing({
      ...EMPTY_FORM,
      category: food ? "food" : "optional",
      address: location,
    });
  };

  const startEdit = (place: SavedPlace) => {
    setError("");
    setEditing({
      id: place.id,
      name: place.name,
      category: place.category,
      address: place.address || "",
      latitude:
        place.latitude != null ? String(place.latitude) : "",
      longitude:
        place.longitude != null ? String(place.longitude) : "",
      notes: place.notes || "",
    });
  };

  const savePlace = async () => {
    if (!editing || !editing.name.trim()) {
      setError("Inserisci il nome della location.");
      return;
    }

    setSaving(true);
    setError("");

    const payload = {
      name: editing.name.trim(),
      category: food ? "food" : editing.category || "optional",
      address: editing.address.trim() || null,
      latitude:
        editing.latitude.trim() === ""
          ? null
          : Number(editing.latitude),
      longitude:
        editing.longitude.trim() === ""
          ? null
          : Number(editing.longitude),
      notes: editing.notes.trim() || null,
      link: null,
    };

    if (
      payload.latitude != null &&
      Number.isNaN(payload.latitude)
    ) {
      setError("Latitudine non valida.");
      setSaving(false);
      return;
    }

    if (
      payload.longitude != null &&
      Number.isNaN(payload.longitude)
    ) {
      setError("Longitudine non valida.");
      setSaving(false);
      return;
    }

    try {
      if (editing.id) {
        await api(`/api/saved/${editing.id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
      } else {
        await api("/api/saved", {
          method: "POST",
          body: JSON.stringify(payload),
        });
      }

      setEditing(null);
      setRefreshKey((value) => value + 1);
    } catch {
      setError("Impossibile salvare la location.");
    } finally {
      setSaving(false);
    }
  };

  const deletePlace = async (place: SavedPlace) => {
    if (
      !window.confirm(
        `Vuoi eliminare "${place.name}" dai luoghi salvati?`
      )
    ) {
      return;
    }

    try {
      await api(`/api/saved/${place.id}`, {
        method: "DELETE",
      });

      setRefreshKey((value) => value + 1);
    } catch {
      setError("Impossibile eliminare la location.");
    }
  };

  const title = food
    ? "Food consigliato"
    : "Tappe Aggiuntive Facoltative";

  const subtitle = food
    ? "Dove mangiare"
    : "Luoghi consigliati";

  return (
    <article
      className={`card saved-list-card ${
        food ? "restaurants-card" : "optional-stops-card"
      }`}
    >
      <div className="saved-list-header">
        <div>
          <small>{food ? "🍴" : "📍"} {title}</small>
          <h2>{subtitle}</h2>
        </div>

        <button
          className="saved-add-button"
          type="button"
          onClick={startAdd}
          aria-label={`Aggiungi ${food ? "food" : "tappa"}`}
        >
          +
        </button>
      </div>

      {editing && (
        <div className="saved-place-editor">
          <h3>
            {editing.id
              ? "Modifica location"
              : food
                ? "Aggiungi food"
                : "Aggiungi tappa"}
          </h3>

          <label>
            Nome
            <input
              value={editing.name}
              onChange={(event) =>
                setEditing({
                  ...editing,
                  name: event.target.value,
                })
              }
              placeholder="Nome della location"
            />
          </label>

          <label>
            Indirizzo
            <input
              value={editing.address}
              onChange={(event) =>
                setEditing({
                  ...editing,
                  address: event.target.value,
                })
              }
              placeholder="Indirizzo, città"
            />
          </label>

          <div className="saved-coordinate-grid">
            <label>
              Latitudine
              <input
                value={editing.latitude}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    latitude: event.target.value,
                  })
                }
                inputMode="decimal"
                placeholder="es. 37.8516"
              />
            </label>

            <label>
              Longitudine
              <input
                value={editing.longitude}
                onChange={(event) =>
                  setEditing({
                    ...editing,
                    longitude: event.target.value,
                  })
                }
                inputMode="decimal"
                placeholder="es. 15.2861"
              />
            </label>
          </div>

          {error && (
            <p className="saved-form-error">{error}</p>
          )}

          <div className="saved-editor-actions">
            <button
              type="button"
              onClick={() => setEditing(null)}
            >
              Annulla
            </button>

            <button
              type="button"
              onClick={savePlace}
              disabled={saving}
            >
              {saving ? "Salvataggio…" : "Salva"}
            </button>
          </div>
        </div>
      )}

      {!places && (
        <p className="muted">Caricamento…</p>
      )}

      {places && places.length === 0 && (
        <div className="saved-empty">
          <p className="muted">
            {food
              ? "Nessun food consigliato per questa area."
              : "Nessuna tappa facoltativa per questa area."}
          </p>

          <button type="button" onClick={startAdd}>
            + Aggiungi
          </button>
        </div>
      )}

      {places && places.length > 0 && (
        <div className="saved-list">
          <div className="saved-list-columns">
            <span>Location</span>
            <span>Distanza</span>
          </div>

          {places.map((place) => {
            const distance = placeDistance(place, position);
            const url = mapsUrl(place);

            return (
              <div className="saved-list-row" key={place.id}>
                <div className="saved-list-location">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {place.name}
                  </a>

                  {place.address && (
                    <small>{place.address}</small>
                  )}

                  <div className="saved-row-actions">
                    <button
                      type="button"
                      onClick={() => startEdit(place)}
                    >
                      Modifica
                    </button>

                    <button
                      type="button"
                      onClick={() => deletePlace(place)}
                    >
                      Elimina
                    </button>
                  </div>
                </div>

                <a
                  className="saved-distance"
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {distance != null
                    ? formatDistance(distance)
                    : "Naviga"}
                  <span>→</span>
                </a>
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}

export function FoodRecommendations({
  location,
  position,
}: {
  location: string;
  position?: Coordinates | null;
}) {
  return (
    <SavedPlacesSection
      location={location}
      position={position}
      food
    />
  );
}

export function OptionalStops({
  location,
  dayNumber: _dayNumber,
  position,
}: {
  location: string;
  dayNumber?: number;
  position?: Coordinates | null;
}) {
  return (
    <SavedPlacesSection
      location={location}
      position={position}
      food={false}
    />
  );
}