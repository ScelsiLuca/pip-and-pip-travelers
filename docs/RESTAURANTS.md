# Live restaurant recommendations

The Home restaurant carousel is backed by `GET /api/restaurants/recommended`. Runtime data is never seeded or fabricated.

## Providers and configuration

- Google Places API (New), Text Search: set `GOOGLE_PLACES_API_KEY` on the backend only.
- Tripadvisor Content API: set `TRIPADVISOR_API_KEY` on the backend only. Without it, Google results remain usable and Tripadvisor is shown as unavailable.
- No API key is exposed through a `VITE_` variable or returned by the API.

Google Text Search uses the Italian query “ristoranti tipici siciliani cucina locale”, a Sicily location bias when coordinates are known, `openNow=true`, `minRating=4.0`, and a narrow field mask. Only results whose official `currentOpeningHours.openNow` is `true` enter the main ranking. Businesses with fewer than 40 Google reviews and obvious fast-food, sushi, hamburger, or named-chain signals are excluded.

## Ranking

Each source is confidence-adjusted with a simple Bayesian mean:

`adjusted = reviews/(reviews+100) * rating + 100/(reviews+100) * 4.2`

With a conservative Tripadvisor match, the final score is 60% adjusted Google plus 40% adjusted Tripadvisor, scaled by match confidence. Without Tripadvisor, the adjusted Google score is used and the UI says that the ranking is based on available data. Review counts are always displayed when available.

Entity matching normalizes names and combines token overlap, city/address agreement, and geographic distance. A Tripadvisor candidate is accepted only at confidence `>= 0.82`; ambiguous candidates remain unmatched.

## Cache, refresh, and offline behavior

- Backend live-result TTL: 10 minutes. This keeps `openNow` short-lived and prevents provider calls on React renders or carousel interaction.
- Manual refresh bypasses the fresh cache but still goes through the backend.
- On provider failure, the backend may return the last cached response marked `OFFLINE`.
- The PWA stores the last normalized response locally as a presentation fallback. Stale cards say “Orari da verificare”, never “Aperto ora”.

Ratings and opening status currently arrive in the same Google response, so the conservative 10-minute TTL applies to the full normalized payload. A future persistence layer can split long-lived place identity/rating data from short-lived opening state without changing the frontend contract.

## Attribution and limitations

The UI identifies Google Places as the source of place and opening-hour data and links each card through the provider `googleMapsUri`. Provider-supplied attributions remain in the normalized response. Tripadvisor values and links are rendered only when returned by the authorized API and conservatively matched.

Places API fields such as `currentOpeningHours`, `rating`, and `userRatingCount` can incur Google Maps Platform charges. Billing, API enablement, quotas, and allowed display/storage must be configured and reviewed in the Google Cloud project. Tripadvisor access requires an authorized partner key. No scraping is performed.
