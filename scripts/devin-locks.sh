#!/usr/bin/env bash
# Manage a shared lock file describing which Devin instances are currently
# working in this repo. The lock file lives OUTSIDE the repo (in
# ~/.devin-locks/<repo-name>.json) so parallel git worktrees don't fight
# over it.
#
# Usage:
#   scripts/devin-locks.sh list
#   scripts/devin-locks.sh claim <slug> <scope-description> <comma-separated-paths>
#   scripts/devin-locks.sh release <slug>
#   scripts/devin-locks.sh force-unlock <slug>
#
# Each Devin instance must:
#   1. `list` to see active claims before starting,
#   2. `claim` its scope before editing,
#   3. `release` when done (even on failure).

set -euo pipefail

# ─── Config ────────────────────────────────────────────────────────────────
# Resolve the repo name from the git toplevel. Fall back to the script's
# parent directory name so the script still works when run from anywhere.
REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [ -z "$REPO_ROOT" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi
REPO_NAME="$(basename "$REPO_ROOT")"

LOCK_DIR="${HOME}/.devin-locks"
LOCK_FILE="${LOCK_DIR}/${REPO_NAME}.json"
mkdir -p "$LOCK_DIR"

# Caller PID and worktree path get recorded with each claim. PID is the bash
# invocation here ($$); it's a hint, not authoritative — by the time someone
# else looks at the lock file the original process may already be gone.
CALLER_PID="$$"
CALLER_CWD="$PWD"

usage() {
    cat <<EOF
Usage: $(basename "$0") <command> [args]

Commands:
  list                                       Print active claims (auto-prunes >8h-old entries)
  claim <slug> <scope-desc> <paths>          Add a claim. <paths> = comma-separated.
                                             Fails (exit 1) if any path overlaps an existing claim.
  release <slug>                             Remove claim for <slug>. Idempotent.
  force-unlock <slug>                        Remove claim for <slug>; warn (for crashed sessions).

Lock file: ${LOCK_FILE}
EOF
    exit 2
}

# Dispatch to a single embedded Python program. Python handles the atomic
# read-modify-write via fcntl.flock — macOS does not ship flock(1), and we
# can't depend on Homebrew util-linux being installed.
run_py() {
    LOCK_FILE="$LOCK_FILE" \
    CALLER_PID="$CALLER_PID" \
    CALLER_CWD="$CALLER_CWD" \
    python3 - "$@" <<'PYEOF'
import datetime as dt
import fcntl
import json
import os
import sys

LOCK_FILE = os.environ["LOCK_FILE"]
CALLER_PID = os.environ.get("CALLER_PID", "")
CALLER_CWD = os.environ.get("CALLER_CWD", "")
MAX_AGE_HOURS = 8


def now_iso() -> str:
    # Timezone-aware UTC, ISO 8601, second precision (matches what humans expect to read).
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def parse_iso(s: str) -> dt.datetime | None:
    try:
        # `fromisoformat` handles the 'Z'-less offset we emit. Python <3.11 needs help with 'Z'.
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except Exception:
        return None


def open_locked(mode: str = "a+"):
    """Open the lock file and acquire an exclusive flock. Returns the file object."""
    f = open(LOCK_FILE, mode)
    fcntl.flock(f.fileno(), fcntl.LOCK_EX)
    return f


def read_data(f) -> dict:
    f.seek(0)
    raw = f.read().strip()
    if not raw:
        return {"tasks": []}
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        print(
            f"ERROR: lock file at {LOCK_FILE} is corrupt: {exc}\n"
            "  Inspect it manually, or `rm` it if you know nothing important is in flight.",
            file=sys.stderr,
        )
        sys.exit(2)
    if not isinstance(data, dict) or not isinstance(data.get("tasks"), list):
        print(f"ERROR: lock file at {LOCK_FILE} has wrong shape", file=sys.stderr)
        sys.exit(2)
    return data


def write_data(f, data: dict) -> None:
    f.seek(0)
    f.truncate(0)
    f.write(json.dumps(data, indent=2))
    f.write("\n")
    f.flush()
    os.fsync(f.fileno())


def prune_stale(data: dict) -> list:
    """Remove tasks older than MAX_AGE_HOURS. Returns the pruned slugs (for warning)."""
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(hours=MAX_AGE_HOURS)
    kept, dropped = [], []
    for t in data.get("tasks", []):
        started = parse_iso(t.get("started_at", ""))
        if started is None or started < cutoff:
            dropped.append(t)
        else:
            kept.append(t)
    data["tasks"] = kept
    return dropped


def overlaps(a_paths: list[str], b_paths: list[str]) -> list[tuple[str, str]]:
    """Return (a, b) pairs where a is a substring of b OR b is a substring of a."""
    hits = []
    for a in a_paths:
        for b in b_paths:
            if a in b or b in a:
                hits.append((a, b))
    return hits


def cmd_list(args: list[str]) -> int:
    if args:
        print("ERROR: `list` takes no arguments", file=sys.stderr)
        return 2
    with open_locked() as f:
        data = read_data(f)
        dropped = prune_stale(data)
        if dropped:
            write_data(f, data)

    # Print warnings AFTER releasing the lock so a slow terminal doesn't hold it.
    for t in dropped:
        print(
            f"WARNING: pruned stale claim slug={t.get('slug')} "
            f"started_at={t.get('started_at')} (>8h old)",
            file=sys.stderr,
        )

    tasks = data["tasks"]
    if not tasks:
        print("(no active claims)")
        return 0

    # Header
    print(f"{'SLUG':<24} {'STARTED (UTC)':<22} {'PID':<8} SCOPE")
    print("-" * 80)
    for t in tasks:
        slug = (t.get("slug") or "?")[:23]
        started = (t.get("started_at") or "?")[:21]
        pid = str(t.get("pid") or "")[:7]
        scope = t.get("scope") or ""
        print(f"{slug:<24} {started:<22} {pid:<8} {scope}")
        wt = t.get("worktree")
        if wt:
            print(f"{'':<24} {'':<22} {'':<8} worktree: {wt}")
        for p in t.get("paths", []):
            print(f"{'':<24} {'':<22} {'':<8}   - {p}")
    return 0


def cmd_claim(args: list[str]) -> int:
    if len(args) != 3:
        print(
            "ERROR: claim takes exactly 3 args: <slug> <scope-desc> <comma-separated-paths>",
            file=sys.stderr,
        )
        return 2
    slug, scope, paths_csv = args
    if not slug or "," in slug or " " in slug:
        print(f"ERROR: invalid slug {slug!r} (no spaces or commas)", file=sys.stderr)
        return 2
    paths = [p.strip() for p in paths_csv.split(",") if p.strip()]
    if not paths:
        print("ERROR: must claim at least one path", file=sys.stderr)
        return 2

    with open_locked() as f:
        data = read_data(f)
        dropped = prune_stale(data)

        # Refuse a duplicate slug — different from a path conflict.
        for t in data["tasks"]:
            if t.get("slug") == slug:
                print(
                    f"ERROR: slug {slug!r} is already claimed (started {t.get('started_at')}). "
                    f"Use `release {slug}` first if this is a fresh attempt.",
                    file=sys.stderr,
                )
                return 1

        conflicts = []
        for t in data["tasks"]:
            hits = overlaps(paths, t.get("paths", []))
            if hits:
                conflicts.append((t, hits))

        if conflicts:
            print(f"ERROR: claim {slug!r} conflicts with active task(s):", file=sys.stderr)
            for t, hits in conflicts:
                print(
                    f"  • slug={t.get('slug')!r} scope={t.get('scope')!r} "
                    f"started_at={t.get('started_at')}",
                    file=sys.stderr,
                )
                for a, b in hits:
                    print(f"      {a!r} overlaps with existing claim on {b!r}", file=sys.stderr)
            print(
                "  → coordinate with the human, narrow your scope, or wait for the other task.",
                file=sys.stderr,
            )
            return 1

        entry = {
            "slug": slug,
            "scope": scope,
            "paths": paths,
            "started_at": now_iso(),
            "worktree": CALLER_CWD,
        }
        if CALLER_PID:
            try:
                entry["pid"] = int(CALLER_PID)
            except ValueError:
                pass
        data["tasks"].append(entry)
        write_data(f, data)

    for t in dropped:
        print(
            f"WARNING: pruned stale claim slug={t.get('slug')} (>8h old) before claiming {slug!r}",
            file=sys.stderr,
        )
    print(f"claimed {slug!r} → {', '.join(paths)}")
    return 0


def cmd_release(args: list[str], force: bool = False) -> int:
    if len(args) != 1:
        print(
            f"ERROR: {'force-unlock' if force else 'release'} takes exactly 1 arg: <slug>",
            file=sys.stderr,
        )
        return 2
    slug = args[0]

    with open_locked() as f:
        data = read_data(f)
        before = len(data["tasks"])
        data["tasks"] = [t for t in data["tasks"] if t.get("slug") != slug]
        removed = before - len(data["tasks"])
        if removed:
            write_data(f, data)

    if removed:
        if force:
            print(
                f"WARNING: force-unlocked {slug!r} (use only when a session crashed)",
                file=sys.stderr,
            )
        print(f"released {slug!r}")
    else:
        # Idempotent: it's fine to release a slug that wasn't held.
        print(f"(no claim for {slug!r})")
    return 0


def main() -> int:
    if len(sys.argv) < 2:
        print("ERROR: missing subcommand", file=sys.stderr)
        return 2
    sub, *rest = sys.argv[1:]
    if sub == "list":
        return cmd_list(rest)
    if sub == "claim":
        return cmd_claim(rest)
    if sub == "release":
        return cmd_release(rest, force=False)
    if sub == "force-unlock":
        return cmd_release(rest, force=True)
    print(f"ERROR: unknown subcommand {sub!r}", file=sys.stderr)
    return 2


sys.exit(main())
PYEOF
}

# ─── Entry ─────────────────────────────────────────────────────────────────
if [ $# -lt 1 ]; then usage; fi

cmd="$1"; shift
case "$cmd" in
    list)
        run_py list
        ;;
    claim)
        if [ $# -ne 3 ]; then usage; fi
        run_py claim "$1" "$2" "$3"
        ;;
    release)
        if [ $# -ne 1 ]; then usage; fi
        run_py release "$1"
        ;;
    force-unlock)
        if [ $# -ne 1 ]; then usage; fi
        run_py force-unlock "$1"
        ;;
    -h|--help|help)
        usage
        ;;
    *)
        echo "ERROR: unknown subcommand: $cmd" >&2
        usage
        ;;
esac
