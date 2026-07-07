# ---- build: install deps + generate protobuf-es code from the .proto ----
FROM node:22-slim AS build
WORKDIR /app
# node:22-slim ships without the system CA bundle; buf (a Go binary) reads the
# system cert store, so `buf generate` below fails TLS to buf.build without this.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install
COPY buf.yaml buf.gen.yaml ./
COPY proto ./proto
RUN npx buf generate
COPY src ./src
# drop dev deps (buf) now that codegen is done
RUN npm prune --omit=dev

# ---- runtime (slim, not alpine, so the Claude Code CLI's bundled tools work) ----
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Claude Code CLI — moderation runs through it, authenticated by a Claude
# subscription via CLAUDE_CODE_OAUTH_TOKEN (no Anthropic API key).
RUN npm install -g @anthropic-ai/claude-code && apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/gen ./gen
COPY --from=build /app/src ./src
COPY package.json ./
# Static legal pages (privacy/terms) served at /legal/* for the app-store listings.
COPY legal ./legal
# Persistent storage for sessions + trust/rate state (mount a volume here).
RUN mkdir -p /app/data
VOLUME ["/app/data"]
ENV TRUST_STORE=/app/data/trust.json \
    SESSION_STORE=/app/data/sessions.json \
    BANS_STORE=/app/data/bans.json
EXPOSE 8080
# Default: the submit service. Run the monitor as a second container with
#   docker run ... repairs-submit-service node src/monitor.js
CMD ["node", "src/server.js"]
