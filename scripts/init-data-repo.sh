#!/usr/bin/env bash
# Bootstrap the separate DATA repo (sharpninja/repairs-data) that the app reads.
# Creates the repo if needed, seeds marketplace.json onto the **approved** branch
# (the published branch the app fetches), and makes it the default branch so PRs
# target it. Run from the app repo root with the GitHub CLI authenticated.
#
#   scripts/init-data-repo.sh [owner] [repo] [seed.json]
#   scripts/init-data-repo.sh sharpninja repairs-data docs/marketplace.json
set -euo pipefail

OWNER="${1:-sharpninja}"
REPO="${2:-repairs-data}"
SEED="${3:-docs/marketplace.json}"
BRANCH="approved"

command -v gh >/dev/null 2>&1 || { echo "Install the GitHub CLI and run 'gh auth login' first: https://cli.github.com"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Run 'gh auth login' first."; exit 1; }
[ -f "$SEED" ] || { echo "Seed file not found: $SEED"; exit 1; }

# Make sure git pushes to github.com authenticate via gh (idempotent).
gh auth setup-git >/dev/null 2>&1 || true

if ! gh repo view "$OWNER/$REPO" >/dev/null 2>&1; then
  echo "Creating $OWNER/$REPO…"
  gh repo create "$OWNER/$REPO" --public \
    -d "Published data catalog for the Repairs app — the app reads the 'approved' branch. Community submissions arrive as PRs."
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git -C "$tmp" init -q
git -C "$tmp" checkout -q -b "$BRANCH"
cp "$SEED" "$tmp/marketplace.json"
cat > "$tmp/README.md" <<EOF
# repairs-data

Published data for the [Repairs](https://github.com/$OWNER/repairs) app.

The app reads \`marketplace.json\` from the **\`$BRANCH\`** branch directly:
\`https://raw.githubusercontent.com/$OWNER/$REPO/$BRANCH/marketplace.json\`

Community submissions arrive as **pull requests against \`$BRANCH\`**. The submit
service (see the app repo's \`server/\`) opens and Claude-moderates them; merging a
PR publishes the change to what every app instance reads. Do not hand-edit outside
of reviewed PRs unless you know what you're doing.
EOF

git -C "$tmp" add -A
git -C "$tmp" -c user.email="app@localhost" -c user.name="repairs-bootstrap" commit -qm "Seed approved catalog"
git -C "$tmp" remote add origin "https://github.com/$OWNER/$REPO.git"
echo "Pushing the '$BRANCH' branch…"
git -C "$tmp" push -q -u origin "$BRANCH" --force-with-lease 2>/dev/null || git -C "$tmp" push -q -u origin "$BRANCH"

# Make 'approved' the default branch so submission PRs target it by default.
gh repo edit "$OWNER/$REPO" --default-branch "$BRANCH" >/dev/null 2>&1 || true

echo
echo "✓ Done."
echo "  App reads: https://raw.githubusercontent.com/$OWNER/$REPO/$BRANCH/marketplace.json"
echo "  Point the submit service at this repo (already the default): GITHUB_REPO=$REPO GITHUB_BASE=$BRANCH"
echo "  Install your GitHub App (or scope the PAT) on $OWNER/$REPO."
