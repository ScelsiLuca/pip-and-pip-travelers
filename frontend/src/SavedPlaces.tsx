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
};

function distanceKm(from: Coordinates, to: { lat: number; lon: number }) {
  const earthRadiusKm = 6371;
  const toRad = (value: number) => value * Math.PI / 180;

  const dLat = toRad(to.lat - from.lat);
  const dLon = toRad(to.lon - from.lon);

  const lat1 = toRad(from.lat);
  const lat2 = toRad(to.lat);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;

  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(km: number) {
  if (km < 1) return `${Math.round(km * 1000)} m da te`;
  return `${km.toFixed(1).replace(".", ",")} km da te`;
}

function placeDistance(place: SavedPlace, position?: Coordinates | null) {
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

export function FoodRecommendations({
  location,
  position,
}: {
  location: string;
  position?: Coordinates | null;
}) {
  const [places, setPlaces] = useState<SavedPlace[] | null>(null);
  useEffect(() => {
    let active = true;
    api<SavedPlace[]>(`/api/saved`).then((all) => {
      if (!active) return;
      const filtered = all
  .filter((p) => p.category === "food")
  .filter(
    (p) =>
      p.address?.toLowerCase().includes(location.toLowerCase()) ||
      p.name?.toLowerCase().includes(location.toLowerCase())
  )
  .sort((a, b) => {
    const distanceA = placeDistance(a, position);
    const distanceB = placeDistance(b, position);

    if (distanceA == null && distanceB == null) return 0;
    if (distanceA == null) return 1;
    if (distanceB == null) return -1;

    return distanceA - distanceB;
  });

setPlaces(filtered.slice(0, 6));
    }).catch(()=>setPlaces([]));
    return ()=>{active=false};
  }, [location, position]);
  if (!places) return <article className="card"><small>🍴 Food consigliato</small><h2>Caricamento…</h2></article>;
  if (!places.length) return <article className="card"><small>🍴 Food consigliato</small><h2>Nessun suggerimento per questa area</h2></article>;
  return (
    <article className="card restaurants-card">
      <div className="card-head"><small>🍴 Food consigliato</small><h2>Dove mangiare</h2></div>
      <div className="saved-places-grid">
        {places.map((p) => (
          <a className="saved-place" key={p.id} href={p.latitude&&p.longitude?`https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name+' '+(p.address||''))}` } target="_blank" rel="noreferrer">
            <h3>{p.name}</h3>
            <p className="muted">{p.address}</p>
            {placeDistance(p, position) != null && (
  <p className="muted">
    📍 {formatDistance(placeDistance(p, position)!)}
  </p>
)}
          </a>
        ))}
      </div>
    </article>
  );
}

export function OptionalStops({
  location,
  dayNumber,
  position,
}: {
  location: string;
  dayNumber?: number;
  position?: Coordinates | null;
}) {
  const [places, setPlaces] = useState<SavedPlace[] | null>(null);
  useEffect(() => {
    let active = true;
    api<SavedPlace[]>(`/api/saved`).then((all) => {
      if (!active) return;
      const filtered = all
  .filter((p) => p.category && p.category !== "food")
  .filter(
    (p) =>
      p.address?.toLowerCase().includes(location.toLowerCase()) ||
      p.name?.toLowerCase().includes(location.toLowerCase())
  )
  .sort((a, b) => {
    const distanceA = placeDistance(a, position);
    const distanceB = placeDistance(b, position);

    if (distanceA == null && distanceB == null) return 0;
    if (distanceA == null) return 1;
    if (distanceB == null) return -1;

    return distanceA - distanceB;
  });

setPlaces(filtered.slice(0, 8));
    }).catch(()=>setPlaces([]));
    return ()=>{active=false};
  }, [location, dayNumber, position]);
  if (!places) return null;
  if (!places.length) return null;
  return (
    <article className="card optional-stops-card">
      <div className="card-head"><small>📍 Tappe Aggiuntive Facoltative</small><h2>Luoghi consigliati</h2></div>
      <div className="saved-places-grid">
        {places.map((p) => (
          <div className="saved-place" key={p.id}>
            <h3>{p.name}</h3>
            <p className="muted">{p.address}</p>
            {placeDistance(p, position) != null && (
  <p className="muted">
    📍 {formatDistance(placeDistance(p, position)!)}
  </p>
)}
            <div className="actions"><a href={p.latitude&&p.longitude?`https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name+' '+(p.address||''))}` } target="_blank" rel="noreferrer">Naviga →</a></div>
          </div>
        ))}
      </div>
    </article>
  );
}
