# Deploying to Render (free plan)

This app ships as a Docker image and runs on Render's **free** plan — no paid
persistent disk. Durability comes from **Litestream**, which continuously
streams the SQLite database to S3-compatible object storage (Cloudflare R2 or
Backblaze B2, both free) and restores it on boot. The included `render.yaml`
Blueprint provisions the web service.

## 1. Create a free object-storage bucket

Pick one (both have a free tier):

- **Cloudflare R2** — create a bucket, then an R2 API token (Account → R2 → Manage
  API Tokens). Endpoint is `https://<account-id>.r2.cloudflarestorage.com`,
  region `auto`.
- **Backblaze B2** — create a bucket + an Application Key. Endpoint is
  `https://s3.<region>.backblazeb2.com`, region e.g. `us-west-004`.

Keep the **bucket name**, **endpoint**, **region**, **access key id**, and
**secret access key** handy for step 3.

## 2. Push to GitHub

```bash
git add .
git commit -m "Deploy artifacts"
git push origin main
```

## 3. Create the service on Render

**New > Blueprint**, point it at this repo. Render reads `render.yaml` and
creates the web service. (No disk is created — that's intentional.)

## 4. Set environment variables

In the service's **Environment** tab, fill in the values marked `sync: false`:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
- `APPLICATION_SECRET` — session/cookie signing secret (a long random string)
- `TMDB_API_KEY`, `RAPIDAPI_KEY`, `TRAKT_KEY`
- `ADMIN_ALLOWLIST`
- `BASE_URL` — the public Render URL, e.g. `https://recommend.onrender.com`.
  This builds the OAuth callback URLs, so it must match your OAuth app config.
- **Litestream:** `LITESTREAM_BUCKET`, `LITESTREAM_ENDPOINT`, `LITESTREAM_REGION`,
  `LITESTREAM_ACCESS_KEY_ID`, `LITESTREAM_SECRET_ACCESS_KEY` (from step 1).

`NODE_ENV=production` and `DB_PATH=/data/recommend.db` are already set in
`render.yaml`.

## 5. Configure OAuth redirect URIs

Add these authorized redirect URIs in each provider's console (using your
actual `BASE_URL`):

- Google:   `${BASE_URL}/auth/google/callback`
- Facebook: `${BASE_URL}/auth/facebook/callback`

## Notes

- **Durability:** Litestream replicates each write to object storage and does a
  final sync on graceful shutdown, so deploys, restarts, and Render's idle
  spin-down lose nothing. A hard kill (OOM/power) during a *fresh-instance*
  destruction can lose at most ~1s of un-synced writes. App crashes where the
  instance survives lose nothing (the SQLite file is still on the local disk).
- **No replication without config:** if `LITESTREAM_BUCKET` is unset the app
  still boots and runs — it just won't replicate (data is then ephemeral). Set
  the Litestream vars to get durability.
- **Free tier cold starts:** the free plan spins the service down after idle
  periods; the first request afterward is slow while it wakes and Litestream
  restores the DB.
- **Node 24:** required for the built-in `node:sqlite` module.
</content>
