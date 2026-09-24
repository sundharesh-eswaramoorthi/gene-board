# Gene Board API image. Build from the repository root with
#   docker compose --profile full build api
# or directly: docker build -t geneboard-api backend

# --- build: a static binary (no cgo; migrations are embedded) ---
FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# --- runtime: distroless, non-root (uid 65532), CA certificates and tzdata included ---
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /usr/local/bin/server
USER nonroot:nonroot
# Container mode: listen on all interfaces (the port mapping decides who connects), trust
# X-Real-IP from private networks (the compose nginx; set TRUSTED_PROXIES=none when clients
# reach the container directly), and never serve with the published development JWT secret
# (a random one is generated when JWT_SECRET is unset; a set one must be 32+ characters).
ENV PORT=8484 \
    GB_CONTAINER=1
EXPOSE 8484
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --start-interval=2s --retries=3 \
    CMD ["/usr/local/bin/server", "healthcheck"]
ENTRYPOINT ["/usr/local/bin/server"]
CMD ["serve"]
