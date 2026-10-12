# --- build the web app ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund
COPY . .
RUN npm run build

# --- tiny runtime: the server has no dependencies ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=4777 \
    NO_OPEN=1 \
    DATA_DIR=/data \
    ACCOUNTS_DIR=/accounts
COPY --from=build /app/dist ./dist
COPY server ./server
COPY package.json ./
RUN mkdir -p /data /accounts && chown -R node:node /data /app
USER node
EXPOSE 4777
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=3s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4777/api/usage >/dev/null 2>&1 || exit 1
CMD ["node", "server/index.js"]
