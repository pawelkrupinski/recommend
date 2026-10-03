# Deploying filmowo (Hetzner k3s)

Production is **https://filmowo.kinowo.net**: one pod on the Hetzner k3s node
`k3s-worker-1`, shared with kinowo and managed by the same Flux GitOps repo
(`pawelkrupinski/movies-gitops`). There is no persistent volume. Durability comes
from **Litestream**, which streams the SQLite database to Cloudflare R2 and
restores it on boot (`litestream.yml`, `docker-entrypoint.sh`).

```
Cloudflare (proxied, Full strict) → Caddy on k3s-worker-1 → NodePort 30920 → pod :9002
```

## Where each piece lives

| Piece | Location |
|---|---|
| Image | `ghcr.io/pawelkrupinski/filmowo` (public), built by `.github/workflows/ci.yml` job `publish` |
| Deployment, Service, ConfigMap | `movies-gitops/filmowo/all.yaml` |
| Image policy (newest `main-<utc>-<sha7>` wins) | `movies-gitops/image-automation/automation.yaml` |
| Flux Kustomization | `movies-gitops/flux/gotk-sync.yaml` (hand-applied, like the others) |
| Caddy vhost | `movies/infra/nix/hosts/k3s-worker-1/default.nix` (`filmowo.kinowo.net`) |
| Node request budget | `movies/worker/src/test/scala/deploy/Node{Memory,Cpu}BudgetSpec.scala` |
| DNS | Cloudflare zone `kinowo.net`, proxied A record `filmowo` → the node |
| Secrets | k8s Secret `filmowo/filmowo-secrets`, never in git |

## Deploying

Push to `main`. When unit, integration and both e2e jobs pass, `publish` pushes
the image under `main-<utc>-<sha7>`. Flux image automation commits that tag
into `filmowo/all.yaml` within about 5 minutes, and the pod is replaced.

**The pod rolls with `Recreate` and `replicas: 1`, on purpose.** Litestream needs
exactly one writer on its R2 path; two writers fork the replica's generations.
So each deploy has a short gap (graceful stop, final sync, then restore on the
new pod), which `public/app.js` retries over. Never scale it above 1, and never
run a second copy against the same bucket path.

Roll back or pin a version by editing the tag in `movies-gitops/filmowo/all.yaml`.

## Secrets

`filmowo-secrets` is built from this repo's `.env.local`. It holds these keys:
`GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET FACEBOOK_APP_ID FACEBOOK_APP_SECRET
APPLICATION_SECRET TMDB_API_KEY RAPIDAPI_KEY TRAKT_KEY ADMIN_ALLOWLIST
LITESTREAM_BUCKET LITESTREAM_ENDPOINT LITESTREAM_REGION LITESTREAM_ACCESS_KEY_ID
LITESTREAM_SECRET_ACCESS_KEY FILMOWO_PROXY_USER FILMOWO_PROXY_PASS`.

To create or rotate it, apply it on the control-plane host (monitoring-1) with
`KUBECONFIG=/etc/rancher/k3s/k3s.yaml kubectl apply -f -`, feeding it a `Secret`
manifest built from those keys. Reloader restarts the pod when the Secret
changes. Non-secret env (`NODE_ENV`, `DB_PATH`, `BASE_URL`) is in the ConfigMap
`filmowo-env`.

## OAuth redirect URIs

- Google: `https://filmowo.kinowo.net/auth/google/callback`
- Facebook: `https://filmowo.kinowo.net/auth/facebook/callback`

## Notes

- **Country detection:** requests now pass through Cloudflare, so `CF-IPCountry`
  reaches the server for the web and mobile apps alike (`src/locale.js`).
- **No replication without config:** if `LITESTREAM_BUCKET` is unset the app
  still boots, but it does not replicate, so its data is ephemeral.
- **Node 24:** required for the built-in `node:sqlite` module.
- The app ran on Render, then on Fly.io (app `filmowo`, `filmowo.fly.dev`),
  before moving here on 2026-10-03.
