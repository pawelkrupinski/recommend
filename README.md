# 🎬 recommend

A self-hosted mashup of **[Movie of the Night](https://www.movieofthenight.com/)**
(*where can I stream this in my country?*) and **[Criticker](https://www.criticker.com/)**
(*learn my taste, predict what I'll like*).

Each user signs in with **Google or Facebook**, rates films (or imports their
history); it learns the genres, keywords, directors and actors they gravitate to,
then ranks titles that are **actually streamable on their services in their
country** — with deep links straight into Netflix/Max/Disney+/etc. Ratings,
streaming services and recommendations are **per account**.

No build step, no `npm install`, zero dependencies — just Node ≥ 24
(uses the built-in `node:sqlite`).

## Setup

1. **Configure secrets.** Locally these are read automatically from
   `../movies/.env.local` if it exists; otherwise copy `.env.example` → `.env` and
   fill in at least the OAuth credentials, `APPLICATION_SECRET`, `ADMIN_ALLOWLIST`
   and `TMDB_API_KEY`. See [Environment](#environment) below.
2. **Run it**
   ```bash
   npm start          # → http://localhost:9002
   ```
3. **Sign in** with Google or Facebook. The first matching `ADMIN_ALLOWLIST` email
   becomes an admin.
4. **Pick your country and streaming services** in Settings (per account).
5. **Seed your taste** — either:
   - **Import** a ratings export (Letterboxd `ratings.csv`, IMDb `ratings.csv`, or Criticker), or
   - **Rate** popular titles in-app.
6. Open **Discover** for ranked picks. Click a poster to see where to watch it.

## Accounts & roles

- **Login required.** Auth is OAuth (Google + Facebook), with a signed-cookie
  session (`src/auth.js`). Callback paths are `/auth/<provider>/callback`.
- **Per-user data.** Ratings, dismissals, "haven't seen", country and streaming
  services are all scoped to the signed-in user; recommendation caches are too.
- **Admins** (emails in `ADMIN_ALLOWLIST`, or toggled on by another admin under
  **Settings → Users**) manage the **global API keys** (TMDB / MotN / Trakt) —
  these are shared by everyone. Regular users only pick their own services.

## Environment

Read from the process environment (and, locally, from `../movies/.env.local`).
Full list in [`.env.example`](./.env.example):

| var | purpose |
|-----|---------|
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google login |
| `FACEBOOK_APP_ID` / `FACEBOOK_APP_SECRET`   | Facebook login |
| `APPLICATION_SECRET` | signs session cookies |
| `ADMIN_ALLOWLIST`    | comma-separated admin emails |
| `TMDB_API_KEY`       | TMDB metadata (required) |
| `RAPIDAPI_KEY` / `TRAKT_KEY` | optional (deep links / collaborative signal) |
| `BASE_URL`   | public origin for OAuth callbacks (prod) |
| `DB_PATH`    | SQLite path (default `./data/recommend.db`) |
| `PORT`       | listen port (default 9002) |

OAuth apps must whitelist the redirect URIs `${BASE_URL}/auth/google/callback`
and `${BASE_URL}/auth/facebook/callback` (plus local equivalents for dev).

## Deploy

See [`DEPLOY.md`](./DEPLOY.md). Ships with a `Dockerfile` and a Render
`render.yaml` (web service + 1 GB persistent disk for the SQLite DB at
`/var/data`). Any single-instance host with a persistent volume works; for
multi-instance scaling, swap SQLite for Turso/libSQL or Postgres.

## Run as a background service (macOS)

Installs a launchd agent so it starts at login and **auto-restarts on crash**
(`KeepAlive`), the same pattern as `~/projects/events`:

```bash
npm run service:install     # generate plist + bootstrap + start on :9002
npm run service:status      # state / pid / last exit
npm run service:restart     # pick up code changes (plain node, not watch)
npm run service:logs        # tail ~/.recommend-logs/server.{out,err}.log
npm run service:uninstall   # stop + remove
```

Resilience built in: launchd `RunAtLoad` + `KeepAlive` + `ThrottleInterval` (10s
crash-loop guard); graceful `SIGTERM`/`SIGINT` shutdown (drains connections, closes
the DB); `uncaughtException`/`unhandledRejection` handlers; and retry-with-backoff on
TMDB calls (429/5xx/network). MotN is deliberately *not* retried — it's rate-capped.

## How the recommender works

`src/taste.js` builds a content-based profile: every rated film contributes its
features (genres, keywords, director, top cast, decade) weighted by how far the
rating sits above/below your personal average. Features seen only once are shrunk
toward zero (low confidence). Candidate titles — pulled from TMDB *discover* filtered
to your services + region, plus TMDB recommendations seeded from your top-rated films —
are scored on those features, blended 75/25 with the TMDB community score, and ranked.

If a **Trakt** key is set, a third candidate pool is added — Trakt's community
*related* titles, seeded from the same top-rated films — and each candidate gets a
small saturating bonus for every loved film Trakt links it to. This is the
collaborative ("people who liked X also liked Y") signal the content model can't see
on its own; without a key the recommender behaves exactly as before.

Each pick is then enriched with its **IMDb rating** and **Metacritic Metascore**
(`src/ratings.js`), shown as badges on the card. Both come from key-free public
endpoints (IMDb's GraphQL CDN; Metacritic's schema.org JSON-LD) and are cached
hard in the DB — no extra API key, no extra setup.

## Layout

| file | role |
|------|------|
| `src/server.js`   | `node:http` server + JSON API (auth-gated, per-user) |
| `src/auth.js`     | Google/Facebook OAuth + signed-cookie sessions |
| `src/env.js`      | config + local secret loading from `../movies/.env.local` |
| `src/db.js`       | `node:sqlite` storage (users, per-user ratings/settings, API cache) |
| `src/tmdb.js`     | TMDB client (metadata, providers, discover, recs) |
| `src/motn.js`     | Movie of the Night client (deep links) |
| `src/trakt.js`    | Trakt client (collaborative "related" signal, optional) |
| `src/ratings.js`  | IMDb + Metacritic ratings (key-free, cached) |
| `src/importers.js`| Letterboxd / IMDb / Criticker CSV → TMDB matching |
| `src/taste.js`    | taste profile + candidate scoring |
| `public/`         | single-page frontend |

Data (users, per-user ratings + cache) lives in `data/recommend.db` (or `DB_PATH`).
A single-user DB from before multi-user is migrated automatically on first boot —
existing ratings are assigned to the first `ADMIN_ALLOWLIST` account.

## Ideas / next steps

- TV series support end-to-end (schema already allows `media_type='tv'`).
- "Why this pick" — show which of your tastes a recommendation matched.
- Decay old ratings; separate "mood" profiles.
- Semantic similarity via plot/keyword embeddings (fixes exact-keyword blind spots).
