#!/bin/bash
set -euo pipefail

# Bootstrap script: auto-spawns a worktree if Devin is in the main checkout,
# then re-invokes itself in the worktree. If already in a worktree, does nothing.

REPO_ROOT="$(git rev-parse --show-toplevel)"
GIT_DIR="$(git rev-parse --git-dir)"

# If .git is a real directory (not a gitdir: pointer), we're in the main checkout.
if [[ -d "$GIT_DIR" && "$GIT_DIR" == ".git" ]]; then
  # We're in the main checkout. Auto-spawn a worktree.
  
  # Generate a slug from the current timestamp + random suffix.
  SLUG="devin-$(date +%s)-$(head -c 4 /dev/urandom | od -An -tx1 | tr -d ' ')"
  
  echo "→ Detected main checkout. Auto-spawning worktree with slug: $SLUG"
  WORKTREE_PATH="$("$REPO_ROOT/scripts/devin-spawn.sh" "$SLUG")"
  
  echo "→ Worktree created at: $WORKTREE_PATH"
  echo "→ Re-invoking Devin in the worktree..."
  
  # Re-exec Devin in the worktree. The new session will see the worktree's .git
  # (a gitdir: pointer) and skip this bootstrap block.
  exec devin --cwd "$WORKTREE_PATH"
else
  # We're in a worktree (or a non-git directory). Proceed normally.
  # The calling session will continue and read the protocol.
  :
fi
