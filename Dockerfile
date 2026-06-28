FROM node:24-alpine

WORKDIR /app

# Litestream binary — continuous SQLite replication to object storage. It's a
# static Go binary, so copying it from the official image works on alpine.
COPY --from=litestream/litestream:0.3.13 /usr/local/bin/litestream /usr/local/bin/litestream

# Copy manifest(s) first to leverage Docker layer caching.
COPY package.json package-lock.json ./

# Install production deps from the lockfile. Load-bearing now: undici (the
# residential-proxy dispatcher behind the scraped sources) is a real prod
# dependency, so a failed/incomplete install must FAIL the build loudly rather
# than ship an image where the scrapers silently degrade to []. No `|| true`.
RUN npm ci --omit=dev

# Copy the rest of the source.
COPY . .

# Litestream config (read from /etc by default) + executable entrypoint.
COPY litestream.yml /etc/litestream.yml
RUN chmod +x /app/docker-entrypoint.sh

# The SQLite DB lives on the container's ephemeral disk; Litestream keeps it
# durable by streaming to object storage and restoring it on boot.
RUN mkdir -p /data

ENV NODE_ENV=production \
    PORT=9002 \
    DB_PATH=/data/recommend.db

EXPOSE 9002

# restore-on-boot, then run node under Litestream (see docker-entrypoint.sh).
ENTRYPOINT ["/app/docker-entrypoint.sh"]
