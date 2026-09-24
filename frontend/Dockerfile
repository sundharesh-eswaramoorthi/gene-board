# Gene Board web image: the React SPA served by nginx, which also proxies /api (REST and the
# project websockets) to the API. Build from the repository root with
#   docker compose --profile full build web
# or directly: docker build -t geneboard-web frontend

# --- build: install the locked dependencies and bundle the app (tsc -b && vite build) ---
FROM node:26-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# --- runtime: nginx serving dist/ with an index.html fallback for client-side routes ---
# nginx-unprivileged: the official nginx build, running as the non-root user nginx (uid 101)
# and listening on 8080.
FROM nginxinc/nginx-unprivileged:1.29-alpine
# The image renders /etc/nginx/templates/*.template with envsubst at start-up (only
# variables defined in the environment are substituted, so nginx's own $vars survive).
ENV API_UPSTREAM=api:8484 \
    DNS_RESOLVER=127.0.0.11
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
# The image stops nginx gracefully (SIGQUIT), which waits for open connections, and the
# project websockets never close on their own: with a board open, every stop would sit out
# Docker's 10 s timeout and end in SIGKILL. Give requests in flight 2 s, then close the rest
# (open boards reconnect).
CMD ["nginx", "-g", "daemon off; worker_shutdown_timeout 2s;"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --start-interval=2s --retries=3 \
    CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]
