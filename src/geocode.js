// Reverse-geocode a coordinate to a 2-letter ISO country code. The web
// onboarding location cascade gets the visitor's GPS position in the browser and
// asks the origin (not an external host — that keeps the provider URL off the
// page's CSP) to turn it into a country. We call a free, no-key reverse geocoder
// and degrade to null on any failure, so the client silently falls back to its
// locale / server-detected signal. Only ever fires when a new visitor grants the
// geolocation prompt during onboarding, so the provider's rate limit is a
// non-issue.
import { fetchWithTimeout } from './fetch.js';

const GEOCODE_TIMEOUT_MS = 4_000;

// BigDataCloud's client reverse-geocode endpoint: no API key, CORS-open, returns
// an ISO `countryCode`. Swap this one function to change providers.
const providerUrl = (lat, lng) =>
  `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`;

const asCode = (raw) => {
  const c = String(raw || '').toUpperCase();
  return /^[A-Z]{2}$/.test(c) ? c : null;
};

// A latitude/longitude → ISO country code, or null when the coordinates are
// bogus or the lookup fails. Never throws.
export async function reverseGeocode(lat, lng) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  try {
    const res = await fetchWithTimeout(providerUrl(lat, lng), {}, GEOCODE_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    return asCode(data.countryCode);
  } catch {
    return null;
  }
}
