# syntax=docker/dockerfile:1

FROM rust:1-bookworm AS builder
WORKDIR /build

COPY crates/t-music-core ./crates/t-music-core
COPY server ./server

# Build only server + shared core on Linux (skipping Windows Tauri desktop target)
RUN printf '[workspace]\nresolver = "2"\nmembers = ["crates/t-music-core", "server"]\n' > Cargo.toml && \
    cargo build --release -p t-music-server

FROM debian:bookworm-slim AS runtime
RUN apt-get update && \
    apt-get install -y --no-install-recommends ca-certificates curl ffmpeg && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /build/target/release/t-music-server /usr/local/bin/t-music-server

ENV PORT=8484
ENV DATA_DIR=/app/data
ENV MUSIC_DIR=/app/music
ENV RUST_LOG=info

RUN mkdir -p /app/data /app/music
VOLUME ["/app/data", "/app/music"]
EXPOSE 8484

CMD ["/usr/local/bin/t-music-server"]
