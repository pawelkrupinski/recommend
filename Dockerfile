FROM node:24-alpine

WORKDIR /app

# Litestream binary — continuous SQLite replication to object storage. It's a
# static Go binary, so copying it from the official image works on alpine.
COPY --from=litestream/litestream:0.3.13 /usr/local/bin/litestream /usr/local/bin/litestream

# Copy manifest(s) first to leverage Docker layer caching.
# package-lock.json may not exist (the app has zero dependencies);
# the trailing glob keeps COPY from failing when it's absent.
COPY package.json package-lock.json* ./

# Install production deps if a lockfile exists. With zero deps this is
# effectively a no-op, so don't let a missing lockfile fail the build.
RUN npm ci --omit=dev || true

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
