FROM node:24-alpine

WORKDIR /app

# Copy manifest(s) first to leverage Docker layer caching.
# package-lock.json may not exist (the app has zero dependencies);
# the trailing glob keeps COPY from failing when it's absent.
COPY package.json package-lock.json* ./

# Install production deps if a lockfile exists. With zero deps this is
# effectively a no-op, so don't let a missing lockfile fail the build.
RUN npm ci --omit=dev || true

# Copy the rest of the source.
COPY . .

# Persistent disk mount point for the SQLite database.
RUN mkdir -p /var/data

ENV NODE_ENV=production \
    PORT=9002 \
    DB_PATH=/var/data/recommend.db

EXPOSE 9002

CMD ["npm", "start"]
