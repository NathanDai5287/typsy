#!/usr/bin/env bash
# Update the main checkout to origin/main.
#
# Refuses to run if:
#   - the current branch is anything other than `main` (so it can never
#     silently move a Devin worktree's feature branch),
#   - the working tree has uncommitted changes (so it can't clobber
#     in-flight edits).
#
# Always uses --ff-only so a divergent local main becomes a loud failure
# instead of a silent merge commit.
#
# Run from your primary checkout (e.g. /Users/natha/Programming/typsy),
# NOT from a sibling ../worktrees/<slug>/. Devin instances live in those
# worktrees; this script is for the human's main-tracking checkout.
#
# Usage:
#   scripts/devin-pull.sh

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
    echo "ERROR: not in a git repository" >&2
    exit 2
fi

cd "$REPO_ROOT"

CURRENT="$(git rev-parse --abbrev-ref HEAD)"
if [ "$CURRENT" != "main" ]; then
    cat >&2 <<EOF
ERROR: refusing to pull — current branch is '$CURRENT', not 'main'.

This script only updates a main-tracking checkout. If this is a Devin
worktree, leave it alone — it owns its own branch. If this is your
primary checkout and you want to switch back to main, run:

  git switch main
  scripts/devin-pull.sh
EOF
    exit 1
fi

if ! git diff-index --quiet HEAD --; then
    echo "ERROR: working tree has uncommitted changes; aborting pull." >&2
    git status --short >&2
    exit 1
fi

# Untracked files don't block --ff-only, but warn so we don't surprise
# the user if a pull adds a same-named file later.
UNTRACKED="$(git ls-files --others --exclude-standard)"
if [ -n "$UNTRACKED" ]; then
    echo "note: untracked files present (not blocking pull):" >&2
    echo "$UNTRACKED" | sed 's/^/  - /' >&2
fi

echo "→ git pull origin main --ff-only"
git pull origin main --ff-only
