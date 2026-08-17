import { useEffect, useState } from "react";
import { api } from "./api";
import type { Coordinates, RestaurantResponse } from "./types";

export const restaurantSavedKey = (location: string) => `pip-restaurants:${location.toLowerCase()}`;
export const restaurantIsStale = (state: string, online: boolean) => state === "OFFLINE" || !online;
const elapsed = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return minutes < 1 ? "ora" : `${minutes} min fa`;
};
const reviews = (value: number | null) => value == null ? "—" : new Intl.NumberFormat("it-IT").format(value);

export function RestaurantCarousel({ location, coordinates }: { location: string; coordinates?: Coordinates | null }) {
  const [data, setData] = useState<RestaurantResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const load = async (refresh = false) => {
    if (!location) return;
    setLoading(true); setError("");
    const params = new URLSearchParams({ location, open_now: "true", limit: "8" });
    if (coordinates) { params.set("lat", String(coordinates.lat)); params.set("lon", String(coordinates.lon)); }
    if (refresh) params.set("refresh", "true");
    try {
      const result = await api<RestaurantResponse>(`/api/restaurants/recommended?${params}`);
      setData(result); localStorage.setItem(restaurantSavedKey(location), JSON.stringify(result));
    } catch {
      const saved = localStorage.getItem(restaurantSavedKey(location));
      if (saved) setData({ ...JSON.parse(saved), dataState: "OFFLINE", cacheFresh: false });
      else setError("I ristoranti live non sono raggiungibili in questo momento.");
    } finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [location, coordinates?.lat, coordinates?.lon]);
  const stale = restaurantIsStale(data?.dataState || "", navigator.onLine);
  return <section className="restaurants-section">
    <header><div><small>SAPORI LOCALI</small><h2>Dove mangiare ora</h2><p>{location} · classifica basata sui dati disponibili</p></div><button onClick={() => void load(true)} disabled={loading} aria-label="Aggiorna ristoranti">↻</button></header>
    {data?.generatedAt && <p className="restaurants-updated">{stale ? "Dati salvati" : "Aggiornato"} · {elapsed(data.generatedAt)}</p>}
    {loading && !data && <div className="restaurant-skeleton" />}
    {error && <p className="restaurants-empty">{error}</p>}
    {data?.dataState === "NOT_CONFIGURED" && <p className="restaurants-empty">I ristoranti live saranno disponibili quando il servizio Google Places sarà configurato.</p>}
    {data && data.dataState !== "NOT_CONFIGURED" && !data.restaurants.length && <p className="restaurants-empty">Nessuno dei ristoranti selezionati risulta aperto ora.</p>}
    {data && data.restaurants.length > 0 && <div className="restaurant-carousel">{data.restaurants.map((item, index) => <a className="restaurant-card" href={item.googleMapsUrl} target="_blank" rel="noreferrer" key={item.placeId}>
      <span className="restaurant-rank">#{index + 1}</span><div><h3>{item.name}</h3><p className={stale ? "open-state stale" : "open-state"}>{stale ? "○ Orari da verificare" : "● Aperto ora"}</p></div>
      <p className="restaurant-address">{item.address}</p><div className="rating-grid"><span><small>GOOGLE MAPS</small><strong>{item.googleRating?.toFixed(1) ?? "—"} ★</strong><em>{reviews(item.googleReviewCount)} recensioni</em></span><span><small>TRIPADVISOR</small><strong>{item.tripadvisorRating?.toFixed(1) ?? "—"}</strong><em>{item.tripadvisorReviewCount != null ? `${reviews(item.tripadvisorReviewCount)} recensioni` : "non disponibile"}</em></span></div>
      {item.priceLevel && <p className="price-level">{item.priceLevel.replace("PRICE_LEVEL_", "").replaceAll("_", " ")}</p>}{item.attributions?.map(source => <small className="place-attribution" key={source.provider}><span>Dati: </span>{source.provider}</small>)}<strong className="restaurant-cta">Apri in Google Maps →</strong>
    </a>)}</div>}
    {data?.providers.google === "LIVE" && <p className="provider-attribution">Dati dei luoghi, valutazioni e orari: Google Maps. Orari soggetti a variazioni.</p>}
  </section>;
}
