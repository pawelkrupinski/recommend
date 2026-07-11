// GET /metrics serves Prometheus exposition for the signals that were previously
// log-only — event-loop lag (via prom-client default metrics), HTTP rate/latency by
// route, main-thread DB pressure, event-loop stalls, and search-in-flight. The
// kinowo-grafana VictoriaMetrics sidecar scrapes it every 15s over the Fly private
// network. We assert the endpoint's shape and that serving requests moves the counters.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { freshDbEnv } from '../helpers/env.js';

const env = freshDbEnv();
const { server } = await import('../../src/server.js');
const { serve, client } = await import('../helpers/http.js');

let base, close;
before(async () => { ({ base, close } = await serve(server)); });
after(() => { close(); env.cleanup(); });

// Sum the values of every non-comment exposition line for `name` whose labels contain
// `labelMatch` (e.g. 'route="/api/search"'). Returns 0 when the series is absent.
const metricValue = (txt, name, labelMatch = '') =>
  txt.split('\n')
    .filter((l) => !l.startsWith('#') && l.startsWith(name) && l.includes(labelMatch))
    .reduce((sum, l) => sum + Number(l.trim().split(/\s+/).pop()), 0);

test('GET /metrics serves Prometheus exposition with the filmowo series', async () => {
  const res = await client(base).raw('/metrics');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const txt = await res.text();
  for (const series of [
    'filmowo_http_requests_total',
    'filmowo_http_request_duration_seconds',
    'filmowo_db_calls_total',
    'filmowo_db_seconds_total',
    'filmowo_event_loop_stalls_total',
    'filmowo_search_inflight',
    'filmowo_nodejs_eventloop_lag_seconds',
  ]) {
    assert.ok(txt.includes(series), `exposition includes ${series}`);
  }
  assert.ok(txt.includes('app="filmowo"'), 'series carry the app label');
});

test('HTTP + DB counters advance as requests are served, labelled by bucketed route', async () => {
  const c = client(base);
  await c.json('/api/me'); // mints a session + reads settings → main-thread DB work
  await c.json('/api/ratings', { method: 'POST', body: { tmdb_id: 42, media_type: 'movie', rating: 8, title: 'X', year: 2000 } });
  await c.json('/api/search?q=stub');

  const txt = await (await c.raw('/metrics')).text();
  assert.ok(metricValue(txt, 'filmowo_http_requests_total', 'route="/api/search"') >= 1, 'search counted under its own route label');
  assert.ok(metricValue(txt, 'filmowo_http_requests_total', 'route="/api/ratings"') >= 1, 'ratings POST counted under its own route label');
  assert.ok(metricValue(txt, 'filmowo_db_calls_total') > 0, 'main-thread DB calls counted');
});
