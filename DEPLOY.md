# Deploying to Render

This app ships as a Docker image and uses a persistent disk for its SQLite
database. The included `render.yaml` Blueprint provisions everything.

## 1. Push to GitHub

```bash
git add .
git commit -m "Add Render deployment artifacts"
git push origin main
```

## 2. Create the service on Render

Option A (recommended): **New > Blueprint**, point it at this repo. Render reads
`render.yaml` and creates the web service + persistent disk automatically.

Option B: **New > Web Service**, pick the repo, choose **Docker** as the runtime
(it uses `./Dockerfile`). Then manually add a disk named `data` mounted at
`/var/data` (1 GB) and a health check path of `/health`.

## 3. Set environment variables (secrets)

In the service's **Environment** tab, fill in the values marked `sync: false`:

- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
- `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`
- `APPLICATION_SECRET` (session/cookie signing secret)
- `TMDB_API_KEY`, `RAPIDAPI_KEY`, `TRAKT_KEY`
- `ADMIN_ALLOWLIST`
- `BASE_URL` — the public Render URL, e.g. `https://recommend.onrender.com`.
  This builds the OAuth callback URLs, so it must match your OAuth app config.

`NODE_ENV=production` and `DB_PATH=/var/data/recommend.db` are already set in
`render.yaml`.

## 4. Configure OAuth redirect URIs

Add these authorized redirect URIs in each provider's console (using your
actual `BASE_URL`):

- Google:   `${BASE_URL}/auth/google/callback`
- Facebook: `${BASE_URL}/auth/facebook/callback`

## Notes

- **Persistent disk:** the SQLite DB lives at `/var/data/recommend.db` on the
  mounted disk, so it survives deploys and restarts. The local `data/` dir is
  excluded from the image via `.dockerignore`.
- **Free tier cold starts:** the free plan spins the service down after idle
  periods; the first request afterward will be slow while it wakes up.
- **Node 24:** required for the built-in `node:sqlite` module.
