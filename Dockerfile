# --- build the web app ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Lockfile must be in sync; no silent fallback to `npm install`.
RUN npm ci --no-fund
COPY . .
RUN npm run build

# --- runtime: server needs no packages (classic-level is optional and Windows-only) ---
FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tzdata
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4777 \
    NO_OPEN=1 \
    DATA_DIR=/data \
    ACCOUNTS_DIR=/accounts
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --omit=optional --no-fund --ignore-scripts
COPY --from=build /app/dist ./dist
COPY server ./server
RUN mkdir -p /data /accounts && chown -R node:node /data /app
USER node
EXPOSE 4777
VOLUME ["/data"]
# Publish the port on loopback only (-p 127.0.0.1:4777:4777); the image listens on 0.0.0.0 inside the container.
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1
CMD ["node", "server/index.js"]
