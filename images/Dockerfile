FROM rust:1.96.1-bookworm AS wasm-builder

RUN cargo install wasm-pack --version 0.13.1 --locked
WORKDIR /src
COPY rust-toolchain.toml ./
COPY wasm ./wasm
RUN cd wasm && wasm-pack build --target web --out-dir pkg

FROM node:24-bookworm AS frontend-builder
WORKDIR /src
COPY frontend/package.json frontend/package-lock.json ./frontend/
RUN npm --prefix frontend ci
COPY frontend ./frontend
COPY --from=wasm-builder /src/wasm/pkg ./wasm/pkg
RUN cd frontend \
    && ./node_modules/.bin/tsc -b \
    && ./node_modules/.bin/vite build

FROM golang:1.25-bookworm AS backend-builder
WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/homevox-server ./cmd/server

FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=backend-builder /out/homevox-server /app/homevox-server
COPY --from=frontend-builder /src/frontend/dist /app/frontend
ENV HOMEVOX_FRONTEND_DIR=/app/frontend
EXPOSE 18088
ENTRYPOINT ["/app/homevox-server"]
