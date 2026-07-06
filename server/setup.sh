#!/usr/bin/env bash
# One-shot setup for the repairs submit + moderation service.
#   ./setup.sh          # interactive: fill .env, then `docker compose up --build`
#   ./setup.sh --no-run # fill .env only, don't start containers
#
# Fills the secrets you must provide (Google OAuth client ID, GitHub token, and the
# Claude subscription token via `claude setup-token`), keeps any values already set,
# then builds and runs the service + moderation monitor.
set -euo pipefail

cd "$(dirname "$0")"
ENV_FILE=".env"
EXAMPLE=".env.example"
RUN=1
[[ "${1:-}" == "--no-run" ]] && RUN=0

say()  { printf '\033[1;36m%s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m%s\033[0m\n' "$*"; }
err()  { printf '\033[1;31m%s\033[0m\n' "$*" >&2; }

# ---- helpers to read/write KEY=VALUE in .env (portable, no in-place sed) ----
get_env() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
set_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp)"
  awk -v k="$key" -v v="$val" '
    $0 ~ "^"k"=" && !done { print k"="v; done=1; next }
    { print }
    END { if (!done) print k"="v }
  ' "$ENV_FILE" > "$tmp"
  mv "$tmp" "$ENV_FILE"
}
# A value counts as "unset" if empty or still the example placeholder.
needs() {
  local v; v="$(get_env "$1")"
  case "$v" in
    ""|xxxxxxxx.apps.googleusercontent.com|github_pat_xxx|sk-ant-oat01-xxxxx) return 0 ;;
    *) return 1 ;;
  esac
}
prompt() { # prompt KEY "Label" [secret]
  local key="$1" label="$2" secret="${3:-}" cur val
  cur="$(get_env "$key")"
  if ! needs "$key"; then
    say "✓ $label already set."
    return
  fi
  if [[ -n "$secret" ]]; then
    read -rs -p "$label: " val; echo
  else
    read -r  -p "$label: " val
  fi
  [[ -n "$val" ]] && set_env "$key" "$val"
}

# ---- prerequisites ----
command -v docker >/dev/null 2>&1 || { err "docker is required."; exit 1; }
if docker compose version >/dev/null 2>&1; then COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then COMPOSE=(docker-compose)
else err "docker compose (or docker-compose) is required."; exit 1; fi

# ---- .env ----
if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE" "$ENV_FILE"
  say "Created $ENV_FILE from $EXAMPLE."
fi

say "== Google OAuth =="
warn "Create a Web OAuth client at https://console.cloud.google.com/apis/credentials"
warn "and add your app origin to 'Authorized JavaScript origins'."
prompt GOOGLE_CLIENT_ID "Google OAuth client ID"

say "== GitHub credential =="
warn "Fine-grained PAT (or GitHub App token) with Contents + Pull requests: Read/Write on the repo."
prompt GITHUB_TOKEN "GitHub token" secret

say "== Claude subscription token (for moderation) =="
if needs CLAUDE_CODE_OAUTH_TOKEN; then
  if command -v claude >/dev/null 2>&1; then
    say "Running 'claude setup-token' — follow the browser prompt, then it prints a token."
    # Show the flow to the user (tee) and capture the sk-ant-oat... token from it.
    TOKEN="$(claude setup-token 2>&1 | tee /dev/tty | grep -oE 'sk-ant-oat[0-9A-Za-z_-]+' | tail -1 || true)"
    if [[ -n "$TOKEN" ]]; then
      set_env CLAUDE_CODE_OAUTH_TOKEN "$TOKEN"
      say "✓ Captured Claude token."
    else
      warn "Couldn't auto-capture the token from the output."
      read -rs -p "Paste the token (sk-ant-oat...): " TOKEN; echo
      [[ -n "$TOKEN" ]] && set_env CLAUDE_CODE_OAUTH_TOKEN "$TOKEN"
    fi
  else
    warn "The 'claude' CLI isn't installed here. On a machine logged into your Claude"
    warn "subscription, run:  npm i -g @anthropic-ai/claude-code && claude setup-token"
    read -rs -p "Paste the token (sk-ant-oat...): " TOKEN; echo
    [[ -n "$TOKEN" ]] && set_env CLAUDE_CODE_OAUTH_TOKEN "$TOKEN"
  fi
else
  say "✓ Claude token already set."
fi

say "== Optional =="
read -r -p "App origin for CORS [$(get_env ALLOWED_ORIGIN)]: " ORIGIN || true
[[ -n "${ORIGIN:-}" ]] && set_env ALLOWED_ORIGIN "$ORIGIN"

# ---- verify required values are present ----
missing=()
for k in GOOGLE_CLIENT_ID GITHUB_TOKEN CLAUDE_CODE_OAUTH_TOKEN; do
  needs "$k" && missing+=("$k")
done
if (( ${#missing[@]} )); then
  err "Still unset: ${missing[*]}. Edit $ENV_FILE and re-run."
  exit 1
fi
say "✓ $ENV_FILE is ready."

# ---- run ----
if (( RUN )); then
  say "Building and starting the service + moderation monitor…"
  "${COMPOSE[@]}" up --build
else
  say "Done. Start it with:  ${COMPOSE[*]} up --build"
fi
