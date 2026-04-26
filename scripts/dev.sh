#!/usr/bin/env bash
# scripts/dev.sh — local dev runner.
#
# Usage:
#   pnpm dev                    # same as --db=staging
#   pnpm dev --db=staging       # local server (3001) + local SQLite (apps/server/data/)
#   pnpm dev --db=prod          # SSH tunnel to production API; web only locally
#
# In `prod` mode the local web (vite, port 5173) talks to the production
# API at https://typsy.cal.taxi via an SSH tunnel that maps your Mac's
# port 3001 → ssh.cal.taxi → ubuntu:localhost:3001. Every API call from
# your local browser writes to the production SQLite at
# /home/natha/typsy/apps/server/data/typsy.db on the Ubuntu box.
# Closing this script (Ctrl-C) tears the tunnel down and restores normal
# behaviour. There is no local server in prod mode — port 3001 on your
# Mac IS the tunnel for as long as the script runs.

set -euo pipefail

DB="${DB:-staging}"
for arg in "$@"; do
  case "$arg" in
    --db=*) DB="${arg#*=}" ;;
    -h|--help)
      sed -n '2,16p' "$0"
      exit 0
      ;;
    *)
      echo "error: unknown arg '$arg' (expected --db=staging | --db=prod)" >&2
      exit 1
      ;;
  esac
done

cd "$(dirname "$0")/.."

# Both modes need shared compiled to packages/shared/dist before vite/tsx start.
pnpm --filter @typsy/shared build >/dev/null

case "$DB" in
  staging)
    exec pnpm exec concurrently --kill-others-on-fail \
      --names "shared,server,web" \
      --prefix-colors "yellow,cyan,green" \
      "pnpm --filter @typsy/shared dev" \
      "pnpm --filter server dev" \
      "pnpm --filter web dev"
    ;;
  prod)
    # `ssh -N` forwards ports without running a remote command; the host alias
    # `ssh.cal.taxi` already has ProxyCommand=cloudflared in ~/.ssh/config so the
    # tunnel rides on the existing Cloudflare path. ExitOnForwardFailure=yes
    # makes ssh die loudly if port 3001 is already taken locally.
    exec pnpm exec concurrently --kill-others-on-fail \
      --names "tunnel,shared,web" \
      --prefix-colors "magenta,yellow,green" \
      "ssh -N -T -o ExitOnForwardFailure=yes -L 3001:localhost:3001 natha@ssh.cal.taxi" \
      "pnpm --filter @typsy/shared dev" \
      "pnpm --filter web dev"
    ;;
  *)
    echo "error: unknown --db=$DB (expected 'staging' or 'prod')" >&2
    exit 1
    ;;
esac
