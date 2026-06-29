# Deploying to Fly.io (cheapest setup)

This app ships as a Docker image and runs on **Fly.io** as the app `filmowo`
(https://filmowo.fly.dev). It runs on a single `shared-cpu-1x` / 512 MB machine
that **auto-stops to zero when idle**, so you only pay while it's serving
requests. There is **no Fly volume** — durability comes from **Litestream**,
which continuously streams the SQLite database to S3-compatible object storage
(Cloudflare R2 or Backblaze B2) and restores it on boot. See `fly.toml`,
`litestream.yml`, and `docker-entrypoint.sh`.

## 1. Object-storage bucket (unchanged)

Same as before — a free Cloudflare R2 (or Backblaze B2) bucket. Keep the
**bucket name**, **endpoint**, **region**, **access key id**, and **secret
access key** handy.

- **Cloudflare R2** — endpoint `https://<account-id>.r2.cloudflarestorage.com`,
  region `auto`.
- **Backblaze B2** — endpoint `https://s3.<region>.backblazeb2.com`,
  region e.g. `us-west-004`.

## 2. Create the app

```bash
fly apps create filmowo --org personal
```

`fly.toml` already pins `app = "filmowo"`, `internal_port = 9002`, the
`/health` check, and scale-to-zero. `NODE_ENV`, `DB_PATH`, and `BASE_URL`
(`https://filmowo.fly.dev`) are set in the `[env]` block.

## 3. Set secrets

Everything marked secret lives as a Fly secret, not in the image. From a
checkout with `.env.local` present:

```bash
set -a && . ./.env.local && set +a
fly secrets set --app filmowo \
  GOOGLE_CLIENT_ID="$GOOGLE_CLIENT_ID" GOOGLE_CLIENT_SECRET="$GOOGLE_CLIENT_SECRET" \
  FACEBOOK_APP_ID="$FACEBOOK_APP_ID" FACEBOOK_APP_SECRET="$FACEBOOK_APP_SECRET" \
  APPLICATION_SECRET="$APPLICATION_SECRET" \
  TMDB_API_KEY="$TMDB_API_KEY" RAPIDAPI_KEY="$RAPIDAPI_KEY" TRAKT_KEY="$TRAKT_KEY" \
  ADMIN_ALLOWLIST="$ADMIN_ALLOWLIST" \
  LITESTREAM_BUCKET="$LITESTREAM_BUCKET" LITESTREAM_ENDPOINT="$LITESTREAM_ENDPOINT" \
  LITESTREAM_REGION="$LITESTREAM_REGION" \
  LITESTREAM_ACCESS_KEY_ID="$LITESTREAM_ACCESS_KEY_ID" \
  LITESTREAM_SECRET_ACCESS_KEY="$LITESTREAM_SECRET_ACCESS_KEY" \
  FILMOWO_PROXY_USER="$FILMOWO_PROXY_USER" FILMOWO_PROXY_PASS="$FILMOWO_PROXY_PASS"
```

## 4. Deploy

```bash
fly deploy --ha=false
```

## 5. OAuth redirect URIs

Add these authorized redirect URIs in each provider's console (`BASE_URL` is
now `https://filmowo.fly.dev`):

- Google:   `https://filmowo.fly.dev/auth/google/callback`
- Facebook: `https://filmowo.fly.dev/auth/facebook/callback`

## 6. CI auto-deploy

`.github/workflows/ci.yml` deploys to Fly after unit + integration + e2e tests
pass on a push to `main`. It needs one repo secret:

- `FLY_API_TOKEN` — an app-scoped deploy token:
  `fly tokens create deploy -a filmowo`, then add it under
  repo → Settings → Secrets → Actions.

## Notes

- **Durability:** Litestream replicates each write to object storage and does a
  final sync on graceful shutdown, so deploys, restarts, and the idle
  auto-stop lose nothing. A hard kill during machine destruction can lose at
  most ~1s of un-synced writes.
- **No replication without config:** if `LITESTREAM_BUCKET` is unset the app
  still boots — it just won't replicate (data is then ephemeral).
- **Cold starts:** the machine auto-stops when idle; the first request
  afterward is slow while it wakes and Litestream restores the DB.
- **Node 24:** required for the built-in `node:sqlite` module.
