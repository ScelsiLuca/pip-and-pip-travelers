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

export function FoodRecommendations({ location }: { location: string }) {
  const [places, setPlaces] = useState<SavedPlace[] | null>(null);
  useEffect(() => {
    let active = true;
    api<SavedPlace[]>(`/api/saved`).then((all) => {
      if (!active) return;
      const filtered = all
        .filter((p: any) => p.category === "food")
        .filter((p: any) => p.address?.toLowerCase().includes(location.toLowerCase()) || (p.name && p.name.toLowerCase().includes(location.toLowerCase())) || p.address?.toLowerCase().includes(location.toLowerCase()) );
      setPlaces(filtered.slice(0, 6));
    }).catch(()=>setPlaces([]));
    return ()=>{active=false};
  }, [location]);
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
          </a>
        ))}
      </div>
    </article>
  );
}

export function OptionalStops({ location, dayNumber }: { location: string; dayNumber?: number }) {
  const [places, setPlaces] = useState<SavedPlace[] | null>(null);
  useEffect(() => {
    let active = true;
    api<SavedPlace[]>(`/api/saved`).then((all) => {
      if (!active) return;
      const filtered = all
        .filter((p: any) => p.category && p.category !== "food")
        .filter((p: any) => p.address?.toLowerCase().includes(location.toLowerCase()) || p.name?.toLowerCase().includes(location.toLowerCase()));
      setPlaces(filtered.slice(0, 8));
    }).catch(()=>setPlaces([]));
    return ()=>{active=false};
  }, [location, dayNumber]);
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
            <div className="actions"><a href={p.latitude&&p.longitude?`https://www.google.com/maps/dir/?api=1&destination=${p.latitude},${p.longitude}`:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.name+' '+(p.address||''))}` } target="_blank" rel="noreferrer">Naviga →</a></div>
          </div>
        ))}
      </div>
    </article>
  );
}
