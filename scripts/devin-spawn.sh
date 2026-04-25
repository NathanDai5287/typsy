#!/usr/bin/env bash
# Spawn a new git worktree for a parallel Devin instance.
#
# Usage:
#   scripts/devin-spawn.sh <slug>
#
# What it does:
#   1. Creates ../worktrees/<slug>/ off the latest origin/main (fetched first).
#   2. Creates branch devin/<slug> in that worktree.
#   3. Prints the absolute worktree path so you can `cd` into it.
#   4. Reminds you to run scripts/devin-locks.sh list before starting work.

set -euo pipefail

if [ $# -ne 1 ]; then
    echo "Usage: $(basename "$0") <slug>" >&2
    echo "Example: $(basename "$0") auth-refactor" >&2
    exit 2
fi

SLUG="$1"

# Slug sanity: alnum, dash, underscore. No slashes (they'd nest the worktree).
if [[ ! "$SLUG" =~ ^[A-Za-z0-9_-]+$ ]]; then
    echo "ERROR: slug must match [A-Za-z0-9_-]+ (got: '$SLUG')" >&2
    exit 2
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

BRANCH="devin/$SLUG"
WORKTREE_DIR="$(cd "$REPO_ROOT/.." && pwd)/worktrees/$SLUG"

if [ -e "$WORKTREE_DIR" ]; then
    echo "ERROR: $WORKTREE_DIR already exists. Pick a different slug or remove it first:" >&2
    echo "       git worktree remove '$WORKTREE_DIR'" >&2
    exit 1
fi

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    echo "ERROR: branch '$BRANCH' already exists. Pick a different slug or delete it:" >&2
    echo "       git branch -D '$BRANCH'" >&2
    exit 1
fi

# Refresh origin/main so the new worktree starts from the latest known main.
# Keep going if there's no remote configured (solo-dev workflow).
echo "→ fetching origin/main…"
if ! git fetch origin main --quiet 2>/dev/null; then
    echo "  (no origin/main reachable — branching off local main)"
fi

# Pick the freshest main reference available.
if git show-ref --verify --quiet refs/remotes/origin/main; then
    BASE="origin/main"
elif git show-ref --verify --quiet refs/heads/main; then
    BASE="main"
else
    echo "ERROR: no main branch found locally or on origin" >&2
    exit 1
fi

mkdir -p "$(dirname "$WORKTREE_DIR")"
echo "→ creating worktree at $WORKTREE_DIR (branch $BRANCH off $BASE)…"
git worktree add -b "$BRANCH" "$WORKTREE_DIR" "$BASE"

echo
echo "✓ worktree ready"
echo
echo "  cd $WORKTREE_DIR"
echo
echo "Before you start a Devin session in there, run:"
echo
echo "  $REPO_ROOT/scripts/devin-locks.sh list"
echo
echo "to see what other instances are already working on. Then have Devin claim"
echo "its scope with:"
echo
echo "  $REPO_ROOT/scripts/devin-locks.sh claim $SLUG \"<one-line description>\" \"<paths>\""
