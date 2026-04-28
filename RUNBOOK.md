# Runbook

Operational reference for the typsy app in production and during local
dev. Whenever you (or an AI agent) hit one of the symptoms below, start
here before guessing — every section is rooted in a real incident and
the diagnostic commands are copy-pasteable.

Companion files: <ref_file file="DEVELOPMENT.md" />, <ref_file file=".devin/knowledge.md" />.

## Quick topology recap

```
your browser ──► localhost:5173 (vite, dev)
                       │
                       │  /api/*  ── vite proxy ──►  localhost:3001
                       │
                       └─ either:
                          (a) `pnpm dev` (staging)   → local Express on :3001
                                                       (apps/server, post-Firebase)
                          (b) `pnpm dev --db=prod`   → SSH tunnel  ssh.cal.taxi → minmus:3001
                                                       (typsy.service, currently pre-Firebase
                                                        because main hasn't been redeployed)

your browser ──► https://typsy.cal.taxi
                       │
                       │  Cloudflare DNS → Cloudflare edge
                       │
                       └─► cloudflared tunnel (systemd unit on minmus)
                              ingress: typsy.cal.taxi → http://localhost:3001
                                       │
                                       └─► typsy.service (Express + better-sqlite3)
```

Files that govern this:
- <ref_file file="apps/web/vite.config.ts" /> — vite proxy `/api → http://localhost:3001`.
- <ref_file file="apps/web/src/lib/api.ts" /> — `BASE` URL resolution (see "Could not connect" below).
- <ref_file file="apps/server/src/index.ts" /> — Express boot, CORS, single-origin SPA fallback.
- <ref_file file="apps/server/src/auth.ts" /> — Firebase token verification middleware.
- <ref_file file="scripts/dev.sh" /> — `pnpm dev` and `pnpm dev --db=prod` orchestration.
- `/etc/systemd/system/typsy.service` on minmus (sudo) — production unit.
- `/etc/cloudflared/config.yml` on minmus (sudo) — tunnel ingress config.

---

## Symptom: "Could not connect to the server. Make sure the backend is running on port 3001."

This red error is rendered in <ref_file file="apps/web/src/App.tsx" /> when the
`useQuery(['user'], fetchUser)` fires and errors. The query is **only**
enabled when you're signed in, so seeing this error means you ARE signed
in but the user fetch failed. Investigate causes in this order — easiest
first, hardest last.

### 1. Vite api.ts BASE bug (empty-string fallback) — the most common one

**Symptom signature:** every API call from the browser fails the same
way; Vite logs no proxy errors; `curl http://localhost:5173/api/user`
from your terminal returns 200 (or whatever the backend says) but the
browser still fails. Network tab shows the browser hitting `/user`,
`/layouts/summary`, etc. **without** the `/api/` prefix and getting
back HTTP 200 with `Content-Type: text/html`.

**Cause:** <ref_file file="apps/web/.env.local" /> has

```
VITE_API_BASE_URL=
```

(the documented "leave blank when Express serves the SPA" default in
`apps/web/.env.example`). Vite turns that into the empty *string*, not
`undefined`. If `apps/web/src/lib/api.ts` resolves `BASE` with `??
'/api'`, the empty string is not nullish so `BASE = ''`. Every fetch
becomes `/<path>` instead of `/api/<path>`. Vite's SPA fallback serves
`index.html` for unknown paths in dev → `res.ok` is true but
`res.json()` throws on the HTML body → useQuery `isError` → red
banner.

**Fix:** treat empty string as "use default" too (already in `main`
after the PR that introduced this runbook):

```ts
const RAW_BASE = import.meta.env.VITE_API_BASE_URL as string | undefined;
const BASE = RAW_BASE && RAW_BASE.length > 0 ? RAW_BASE.replace(/\/$/, '') : '/api';
```

**One-shot diagnosis from the terminal:**

```bash
# If this returns HTTP 200 + text/html, the BASE bug is back.
curl -s -o /dev/null -w "HTTP %{http_code}, content-type: %{content_type}\n" \
  http://localhost:5173/user

# Confirm by inspecting Vite's transformed bundle:
curl -sS http://localhost:5173/src/lib/api.ts | grep -E "BASE|RAW_BASE"
```

The good output contains `RAW_BASE && RAW_BASE.length > 0 ? ... : "/api"`.
The bad output has `?? "/api"`.

### 2. `pnpm dev --db=prod`: Cloudflare tunnel routing broken on minmus

**Symptom signature:** `curl https://typsy.cal.taxi/api/health` returns
HTTP 404 with response headers `server: cloudflare`, `cf-cache-status:
DYNAMIC`, **no** `x-powered-by: Express`. Every path (including `/`)
404s the same way. This is Cloudflare itself answering — the request
never reached your origin. SSH tunnels through `ssh.cal.taxi` will also
intermittently fail because that hostname uses the same tunnel
infrastructure.

**Most common cause** (this has happened): a stray `cloudflared tunnel
run` process on minmus, started without `--config /etc/cloudflared/config.yml`,
competing with the systemd-managed cloudflared. Both connect to the
same tunnel ID; Cloudflare load-balances requests between them; the
stray instance has no ingress rule for `typsy.cal.taxi → localhost:3001`,
so half the requests get a generic 404.

This was originally spawned by a previous AI shell that ran something
like `sudo systemctl restart cloudflared 2>&1 || cloudflared tunnel run 2>&1 &`.
The `sudo` failed (no password); the `||` fallback launched cloudflared
without sudo and without the right config, and that fallback ran
silently in the background for over a month before being noticed.

**Diagnose:**

```bash
ssh natha@minmus '
  echo "=== cloudflared processes (should be exactly ONE) ==="
  pgrep -af cloudflared

  echo "=== systemd unit ==="
  systemctl is-active cloudflared
  systemctl is-active typsy

  echo "=== cloudflared metrics (should show 4 ha_connections, 0 errors) ==="
  curl -s http://127.0.0.1:20241/metrics \
    | grep -E "^cloudflared_tunnel_(ha_connections|request_errors|server_locations)"

  echo "=== port 3001 listening ==="
  ss -tln | grep ":3001"

  echo "=== local-loopback origin probe ==="
  curl -sS -w "\nHTTP %{http_code}\n" http://localhost:3001/api/health
'
```

You want to see exactly **one** `cloudflared` process — the one with
`--config /etc/cloudflared/config.yml`. Anything else is the bug.

**Fix:** kill the rogue process(es). They're owned by `natha`, no sudo
needed, but SIGTERM may not work — use `-9`:

```bash
ssh natha@minmus 'pkill -9 -f "cloudflared tunnel run" -U natha'
# or, if you've identified the exact PIDs:
ssh natha@minmus 'kill -9 <pid> [<parent_bash_pid>]'
```

After the kill, give Cloudflare ~30–90 s to drop the dead connections,
then re-probe `https://typsy.cal.taxi/api/health` — should return 200
with `{"ok":true}` (only if the deployed code is post-Firebase; older
deployed code lacks `/api/health` and returns Express's "Cannot GET
/api/health" — that's fine, see §5 below).

### 3. Local Express on :3001 isn't running (only relevant in `pnpm dev` staging)

```bash
lsof -nP -iTCP:3001 -sTCP:LISTEN
# Expect a node process. If you see ssh, you're actually in --db=prod mode.
# If empty, restart `pnpm dev` from the repo root.

curl -sS -w "\nHTTP %{http_code}\n" http://localhost:3001/api/health
# 200 {"ok":true} = healthy, post-Firebase server.
# Connection refused = no server.
```

### 4. Firebase token issue (only in staging, where the local server actually verifies tokens)

If `/api/health` returns 200 but `/api/user` returns 401, the request
is reaching the server but the auth middleware is rejecting your
token. Possible causes:

- **You're not signed in.** If so, App.tsx renders LoginPage, not the
  red banner. If you see the banner you ARE signed in.
- **Your Firebase token expired or got into a weird state.** Sign out
  + sign in again from the app. Browser DevTools → Application →
  IndexedDB → `firebaseLocalStorageDb` is where Firebase keeps its
  state if you want to nuke it manually.
- **`apps/server/.env` is missing or `firebase-service-account.json`
  is gone/invalid.** A bad service-account file makes
  `admin.auth().verifyIdToken()` throw with a specific Firebase error
  string, which the middleware passes through:

  ```bash
  # Send a structurally-valid-but-unsigned JWT. If you get back
  # "Firebase ID token has 'kid' claim which does not correspond to a
  # known public key", firebase-admin is loading correctly. If you get
  # "Firebase Admin not configured" or a credential error, the .env or
  # service-account file is broken.
  curl -sS -w "\nHTTP %{http_code}\n" \
    -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImFiYyJ9.eyJzdWIiOiJ4In0.x" \
    http://localhost:3001/api/user
  ```

- **Last-resort dev escape hatch** (NEVER set in production): in
  `apps/server/.env`, `BYPASS_AUTH=1`, plus in `apps/web/.env.local`,
  `VITE_BYPASS_AUTH=1`. Both flags must be set together; the server
  will then resolve `req.userId` via `getCurrentUserId()` (real vs
  synthetic via `TYPSY_DATA_MODE`).

### 5. Deployed minmus code is older than your local code

CI auto-merges PRs to `main` but **does not** deploy them — the
`typsy.service` on minmus keeps re-execing whatever was in
`apps/server/dist/` at the time of the last build. If the bundle hash
on `https://typsy.cal.taxi/` doesn't match a fresh local
`pnpm --filter web build`, prod is stale.

```bash
# Compare the hash served by prod vs what main builds locally.
curl -s https://typsy.cal.taxi/ | grep -oE 'assets/index-[^"]*\.js'
pnpm --filter web build && \
  ls apps/web/dist/assets/index-*.js | sed -E 's|.*/(.*)|\1|'
```

To deploy, follow **"Deploying to production"** below. First-time
deploy of post-Firebase code also requires `apps/server/.env` populated
per `apps/server/.env.example`
(`GOOGLE_APPLICATION_CREDENTIALS=...`, `TYPSY_OWNER_FIREBASE_UID=...`,
`PORT=3001`). Without those env vars the server's `initAdmin()` will
throw on first request and every `/api/*` will 401. The deploy contract
is also documented in `.devin/knowledge.md` under "Production deploy
contract".

---

## Deploying to production

There is **no auto-deploy**. CI auto-merges PRs to `main` (and Vercel
rebuilds its preview), but the live site at `https://typsy.cal.taxi` is
served by `typsy.service` on `minmus`, which runs the compiled output
in `apps/server/dist/` and serves the SPA bundle from `apps/web/dist/`.
Both `dist/` directories are gitignored, so a fresh `git pull` alone
does nothing — the server keeps re-execing the old compiled JS.

To ship merged code to prod, SSH in and run the build:

```bash
ssh natha@minmus '
  set -euo pipefail
  cd /home/natha/Programming/typsy
  git pull --ff-only origin main
  pnpm install --frozen-lockfile        # only if pnpm-lock.yaml changed
  pnpm build                            # mandatory: emits shared/dist, server/dist, web/dist
  sudo systemctl restart typsy
'
```

Why each step matters:

- **`git pull`** — fetches the new TS / TSX source. Use `--ff-only` so
  the deploy aborts loudly if minmus has unexpected divergent commits.
- **`pnpm install`** — only if `pnpm-lock.yaml` changed. Re-runs
  `better-sqlite3`'s native build via the `pnpm.onlyBuiltDependencies`
  allowlist; without that, `node dist/index.js` crashes with
  "Could not locate the bindings file".
- **`pnpm build`** is mandatory and produces three things in topological
  order (per `.devin/knowledge.md` → Production deploy contract):
    - `packages/shared/dist/` — raw `node` cannot load `.ts`.
    - `apps/server/dist/` — `tsc` output **plus** a copy of
      `apps/server/src/db/migrations/*.sql` (the server's `build`
      script does the `cp -R`; `tsc` does not).
    - `apps/web/dist/` — Vite bundle the SPA fallback in
      `apps/server/src/index.ts` serves on every non-`/api/*` GET.
- **`systemctl restart typsy`** — picks up the new compiled output.
  Migrations run on startup automatically via `getDb()`, so no separate
  migration step is required.

**Verify the deploy landed:**

```bash
# Bundle hash should change. The hash is baked into the served HTML
# (Vite produces a content-hashed JS file like assets/index-AbCdEf12.js).
curl -s https://typsy.cal.taxi/ | grep -oE 'assets/index-[^"]*\.js'

# The /api/health route is post-Firebase. Confirm it's the new build:
curl -sI https://typsy.cal.taxi/api/health | grep -E "(HTTP|x-powered-by)"
# HTTP/2 200
# x-powered-by: Express   ← request reached your Express, not just CF.

# Optional: spot-check the systemd unit picked up the restart cleanly.
ssh natha@minmus 'systemctl status typsy --no-pager | head -8'
```

**If the build fails on minmus** (TypeScript error, missing native
binding, etc.), the existing `dist/` is unchanged and `typsy.service`
keeps running the previous build. Fix the issue locally, push a new
PR, and re-run the deploy.

**To roll back**, check out the previous commit and rebuild:

```bash
ssh natha@minmus '
  cd /home/natha/Programming/typsy
  git log --oneline -5      # find the SHA you want to roll back to
  git checkout <SHA>
  pnpm build
  sudo systemctl restart typsy
'
```

The `dist/` outputs are gitignored, so you do need to rebuild for
rollback too — there's no "previous build" cached on disk.

---

## DB management: copying between local and prod

The repo intentionally has no automated migration tooling for moving
data between `apps/server/data/typsy.db` (your Mac) and
`/home/natha/Programming/typsy/apps/server/data/typsy.db` (minmus). Use
these patterns when you need to.

### Pull live prod DB → local (read-only-side; safe; doesn't touch prod)

Use `sqlite3 .backup` rather than a raw `cp`. `.backup` is online,
locking-aware, and produces a checkpointed snapshot file; a raw `cp`
can miss recent writes that are still sitting in `typsy.db-wal`.

```bash
# 1. Defensive: snapshot your CURRENT local DB so you can restore.
cd apps/server/data && TS=$(date +%Y%m%d-%H%M%S) && \
  cp -av typsy.db typsy.db.beforeprodimport-$TS && \
  [ -f typsy.db-wal ] && cp -av typsy.db-wal typsy.db-wal.beforeprodimport-$TS; \
  [ -f typsy.db-shm ] && cp -av typsy.db-shm typsy.db-shm.beforeprodimport-$TS

# 2. Take a clean snapshot of live prod (no service stop needed).
ssh natha@minmus '
  sqlite3 /home/natha/Programming/typsy/apps/server/data/typsy.db \
    ".backup /tmp/typsy-snapshot.db"
  sqlite3 /tmp/typsy-snapshot.db "PRAGMA integrity_check"
'

# 3. Pull the snapshot down.
scp natha@minmus:/tmp/typsy-snapshot.db /tmp/typsy-snapshot.db
ssh natha@minmus 'rm /tmp/typsy-snapshot.db'

# 4. Stop your `pnpm dev` if it's running (so the local server isn't
#    holding a file handle on the old typsy.db).

# 5. Replace local DB; remove stale WAL/SHM (they belong to the old DB).
cd apps/server/data && \
  rm -fv typsy.db typsy.db-wal typsy.db-shm && \
  install -m 644 /tmp/typsy-snapshot.db ./typsy.db && \
  rm -f /tmp/typsy-snapshot.db

# 6. Restart `pnpm dev`. The server will run any missing migrations
#    against the imported DB on startup, and seedData() will re-add any
#    locally-known layouts that aren't in the snapshot.
```

### Push a local DB → live prod (DESTRUCTIVE; use only when you mean it)

This stops `typsy.service`, snapshots the existing prod DB beside the
live one, swaps in the new file, and restarts. Ask for confirmation
from the human BEFORE running.

```bash
# Stage the new DB on minmus first (no destructive effect).
scp /path/to/new.db natha@minmus:/tmp/typsy-incoming.db
ssh natha@minmus 'sqlite3 /tmp/typsy-incoming.db "PRAGMA integrity_check"'

# Then run the swap (requires sudo for systemctl). You can paste this
# whole block into your terminal — sudo prompts once.
ssh -t natha@minmus 'sudo bash -c "
set -euo pipefail
TS=\$(date +%Y%m%d-%H%M%S)
DATA=/home/natha/Programming/typsy/apps/server/data

systemctl stop typsy

cp -av \$DATA/typsy.db \$DATA/typsy.db.preswap-\$TS
[ -f \$DATA/typsy.db-wal ] && cp -av \$DATA/typsy.db-wal \$DATA/typsy.db-wal.preswap-\$TS || true
[ -f \$DATA/typsy.db-shm ] && cp -av \$DATA/typsy.db-shm \$DATA/typsy.db-shm.preswap-\$TS || true

rm -fv \$DATA/typsy.db-wal \$DATA/typsy.db-shm

install -o natha -g natha -m 644 /tmp/typsy-incoming.db \$DATA/typsy.db
rm -f /tmp/typsy-incoming.db

systemctl start typsy
sleep 2
systemctl is-active typsy
sudo -u natha sqlite3 \$DATA/typsy.db \"SELECT \\\"sessions=\\\" || COUNT(*) FROM sessions;\"
"'
```

To roll back, install the matching `typsy.db.preswap-<ts>` file using
the same pattern. The defensive `.preswap-*` files are kept indefinitely
unless you delete them — clean them up periodically (`rm
$DATA/typsy.db.preswap-*` after you're confident no rollback is needed).

### Schema sanity check before any swap

```bash
diff <(sqlite3 source.db ".schema") <(sqlite3 target.db ".schema")
sqlite3 source.db "SELECT * FROM _migrations ORDER BY applied_at"
sqlite3 target.db "SELECT * FROM _migrations ORDER BY applied_at"
```

If `_migrations` rows differ (one side has migrations the other
doesn't), the receiving server's `getDb()` will run the missing
migrations on startup. That's fine for **forward** moves (older DB →
newer code), but if you push a NEWER DB at OLDER code (e.g. a DB with
`firebase_uid` column → a pre-Firebase server), the older code won't
know about the extra column. Usually harmless but worth noting.

---

## Useful diagnostic commands

```bash
# Quick mode check: am I in pnpm dev (staging) or pnpm dev --db=prod?
lsof -nP -iTCP:3001 -sTCP:LISTEN
# COMMAND node  → local Express (staging)
# COMMAND ssh   → SSH tunnel (prod)

# End-to-end smoke for whatever's currently wired up:
curl -sS -w "\nHTTP %{http_code}\n" http://localhost:5173/api/health

# Cloudflare-side smoke (only meaningful when prod is reachable, i.e.
# either you're testing typsy.cal.taxi directly or you're in --db=prod):
curl -sI https://typsy.cal.taxi/api/health
# Look for: x-powered-by: Express  → request reached your origin.
# server: cloudflare with NO x-powered-by → Cloudflare 404'd it (§2).

# Cloudflare CORS preflight (mimics what a real browser sends):
curl -sS -i -X OPTIONS \
  -H "Origin: http://localhost:5173" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: authorization,content-type" \
  https://typsy.cal.taxi/api/user

# Check what the live prod typsy.service is doing:
ssh natha@minmus 'systemctl status typsy --no-pager | head -20; \
  journalctl -u typsy -n 20 --no-pager'

# Check cloudflared health (metrics endpoint is local-only on minmus):
ssh natha@minmus 'curl -s http://127.0.0.1:20241/metrics \
  | grep -E "^cloudflared_tunnel_(ha_connections|request_errors)"'
```

---

## Things to NOT do

- **Don't open port 3001 with iptables / ufw on minmus.** Both
  `typsy.cal.taxi` and `ssh.cal.taxi` are Cloudflare tunnels —
  cloudflared dials *outbound* from minmus, no inbound port needs to
  be open. Modifying iptables there would conflict with ufw (ufw is
  active on minmus 24.04) and not solve any real problem.
- **Don't `cp` a live SQLite file as a backup.** Use `sqlite3 src
  ".backup dst"` so the WAL is incorporated. Direct `cp` of `typsy.db`
  alone misses any writes still in `typsy.db-wal`.
- **Don't run `cloudflared tunnel run` manually on minmus.** The
  systemd unit (`/etc/systemd/system/cloudflared.service`) already
  manages it. A second instance silently corrupts request routing
  (see §2 above).
- **Don't paste secrets into chat with an AI agent.** `sudo` passwords
  end up in transcripts. Either run the privileged step yourself or
  rotate the password afterward (`ssh natha@minmus 'passwd'`).
- **Don't edit files in the main checkout** when you're an AI agent.
  Per `.devin/PARALLEL_PROTOCOL.md`, work happens in
  `../worktrees/<slug>/` only. The main checkout is a fragile
  reference point that other agents' worktrees depend on.
