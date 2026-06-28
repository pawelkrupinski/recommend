// Outbound HTTP with a hard timeout. Node's global `fetch` has NO default
// timeout: a hung upstream (an OAuth provider, IMDb, Metacritic, MotN, Trakt,
// TMDB) leaves the request promise pending indefinitely. Under load those stall
// the handlers waiting on them, connections pile up, and the instance stops
// answering — which Cloudflare/Render surface as intermittent 502/503. Aborting
// after `ms` turns a hung upstream into a normal rejection the callers already
// treat as a transient failure (cache a negative, retry, or degrade gracefully).
import { config } from './env.js';

const DEFAULT_TIMEOUT_MS = 10_000;

// A real browser's User-Agent. Several upstreams (Trakt behind Cloudflare, IMDb's
// CDN, Metacritic, the scraped sites) 403 requests that send Node's default (or
// no) UA, so every outbound scrape/API call presents this one.
export const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export function fetchWithTimeout(url, options = {}, ms = DEFAULT_TIMEOUT_MS) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(ms) });
}

// ---- Proxied fetch for scraped sources ------------------------------------
// Scrapers (Letterboxd/Filmweb/JustWatch) need a residential egress to avoid
// Cloudflare ASN blocks on our datacenter IP. We route them through Decodo's ISP
// proxy, rotating one IP per port so no single IP trips Decodo's per-IP auth cap.
// undici is imported lazily so the rest of the app — and the test suite — never
// pulls it in unless a scrape actually runs.
const PROXY_TIMEOUT_MS = 20_000; // scraped HTML pages are larger/slower than APIs
let ProxyAgentCtor;       // cached undici export
const agents = new Map(); // port -> ProxyAgent (pools connections, amortises auth)
let nextPort = 0;         // round-robin cursor across the egress pool

export const proxyConfigured = () => !!(config.proxy.user && config.proxy.pass);

async function agentForNextPort() {
  if (!ProxyAgentCtor) ({ ProxyAgent: ProxyAgentCtor } = await import('undici'));
  const { host, ports, user, pass } = config.proxy;
  const port = ports[nextPort++ % ports.length];
  if (!agents.has(port)) {
    agents.set(port, new ProxyAgentCtor(`http://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${host}:${port}`));
  }
  return agents.get(port);
}

// Fetch through the residential proxy when configured, else a direct request
// (fine locally; in prod the proxy is always set). Callers treat any throw as a
// transient miss and degrade to [].
export async function proxiedFetch(url, options = {}, ms = PROXY_TIMEOUT_MS) {
  const opts = { ...options, signal: AbortSignal.timeout(ms) };
  if (proxyConfigured()) opts.dispatcher = await agentForNextPort();
  return fetch(url, opts);
}

// GET a page through the residential proxy with a browser UA, returning its body
// text — or null on any non-200 or failure. The shared front end of the scraped
// sources (Letterboxd/Filmweb), which then parse the text and degrade to [].
export async function proxiedText(url) {
  try {
    const res = await proxiedFetch(url, { headers: { 'User-Agent': BROWSER_UA } });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}
