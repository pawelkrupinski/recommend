// Prometheus metrics for filmowo, served at GET /metrics and scraped every 15s by
// the kinowo-grafana VictoriaMetrics sidecar over the Fly private network
// (filmowo.internal:9002). These expose — as queryable series — the signals that
// were previously only in the logs: event-loop lag, HTTP rate/latency by route, DB
// pressure, event-loop stalls, and how often the build worker is paused for a search.
//
// Everything here is MAIN-THREAD scoped: the build worker has its own module
// instance and never serves /metrics, so registration is guarded behind
// isMainThread — that keeps the worker free of the default GC/eventloop probes and
// makes every record fn a no-op there (a build-thread DB call, say, isn't double
// counted). What the worker's builds cost shows up indirectly and correctly in the
// MAIN thread's event-loop lag, which is what request latency actually feels.
import client from 'prom-client';
import { isMainThread } from 'node:worker_threads';
import { inFlight } from './build-backpressure.js';

const registry = new client.Registry();
registry.setDefaultLabels({ app: 'filmowo' });

// Only the main thread serves /metrics; skip all probe setup in the build worker.
const active = isMainThread;
if (active) client.collectDefaultMetrics({ register: registry, prefix: 'filmowo_' });

// Register a metric only on the active (main) thread; return null elsewhere so the
// record helpers below short-circuit without a per-call thread check at every site.
const mk = (Ctor, cfg) => (active ? new Ctor({ ...cfg, registers: [registry] }) : null);

const httpTotal = mk(client.Counter, {
  name: 'filmowo_http_requests_total',
  help: 'HTTP requests handled, by method/route/status',
  labelNames: ['method', 'route', 'status'],
});
const httpDuration = mk(client.Histogram, {
  name: 'filmowo_http_request_duration_seconds',
  help: 'HTTP request handler wall-clock, by method/route/status',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
});
const dbCalls = mk(client.Counter, {
  name: 'filmowo_db_calls_total',
  help: 'main-thread node:sqlite prepared-statement calls',
});
const dbSeconds = mk(client.Counter, {
  name: 'filmowo_db_seconds_total',
  help: 'main-thread wall-clock spent inside node:sqlite calls',
});
const stalls = mk(client.Counter, {
  name: 'filmowo_event_loop_stalls_total',
  help: 'event-loop stalls past the perf threshold (see perf.js)',
});
// A gauge sampled at scrape time straight from the backpressure channel — no record
// site to keep in sync, and it reads the same shared counter the build worker parks on.
mk(client.Gauge, {
  name: 'filmowo_search_inflight',
  help: 'latency-sensitive (search) requests in flight the build worker parks for',
  collect() { this.set(inFlight()); },
});

// Record one served HTTP request. `route` must be a low-cardinality label (the
// caller buckets asset/other paths — see server.js routeLabel).
export function observeHttp(method, route, status, seconds) {
  if (!active) return;
  const labels = { method, route, status: String(status) };
  httpTotal.inc(labels);
  httpDuration.observe(labels, seconds);
}
export function observeDb(seconds) {
  if (!active) return;
  dbCalls.inc();
  dbSeconds.inc(seconds);
}
export function observeStall() {
  if (active) stalls.inc();
}

export const metricsContentType = registry.contentType;
export const metricsText = () => registry.metrics();
