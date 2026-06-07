# syntax=docker/dockerfile:1
# Multi-stage build — produces a minimal Alpine image with no build toolchain.
# Build context: server-go/

# ---------------------------------------------------------------------------
# Stage 1 — compile
# ---------------------------------------------------------------------------
FROM golang:1.23-alpine AS builder

WORKDIR /src

# Cache dependency downloads separately from source changes
COPY go.mod go.sum ./
RUN go mod download -x

# Build arguments for version stamping
ARG VERSION=dev
ARG COMMIT=none
ARG DATE=unknown

COPY . .

RUN CGO_ENABLED=0 GOOS=linux \
    go build -trimpath \
      -ldflags="-s -w \
        -X main.version=${VERSION} \
        -X main.commit=${COMMIT} \
        -X main.date=${DATE}" \
      -o /agent-session-viewer .

# ---------------------------------------------------------------------------
# Stage 2 — runtime
# ---------------------------------------------------------------------------
FROM alpine:3.20

# ca-certificates: needed for HTTPS outbound calls (pricing fetches, etc.)
# tzdata: needed for correct local-time display of session timestamps
RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /agent-session-viewer .

# Default env — override via -e or --env-file
ENV PORT=3000 \
    HOST=0.0.0.0

EXPOSE 3000

ENTRYPOINT ["/app/agent-session-viewer"]
