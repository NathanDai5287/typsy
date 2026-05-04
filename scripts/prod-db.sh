#!/usr/bin/env bash
# scripts/prod-db.sh — helper for backing up / listing / restoring the production SQLite DB.
#
# Designed to be run ON the production backend box (the machine running `typsy.service`).
#
# Usage:
#   scripts/prod-db.sh backup
#   scripts/prod-db.sh list
#   scripts/prod-db.sh restore /absolute/path/to/backup.db --yes
#
# Notes:
# - Backups are created via `sqlite3 .backup` (online, WAL-safe).
# - Backups are stored under $DATA/backups/YYYY/MM/ with timestamped filenames.
# - Restore is DESTRUCTIVE and requires --yes.

set -euo pipefail

REPO_ROOT="${TYPSY_REPO_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
DATA="${TYPSY_DATA_DIR:-$REPO_ROOT/apps/server/data}"
LIVE_DB="$DATA/typsy.db"
BACKUPS_DIR="$DATA/backups"

cmd="${1:-}"
shift || true

case "$cmd" in
  backup)
    TS="$(date +%Y%m%d-%H%M%S)"
    BKDIR="$BACKUPS_DIR/$(date +%Y)/$(date +%m)"
    mkdir -p "$BKDIR"
    OUT="$BKDIR/typsy-$TS.db"
    sqlite3 "$LIVE_DB" ".backup $OUT"
    sqlite3 "$OUT" "PRAGMA integrity_check" | grep -qx ok
    echo "backup=$OUT"
    ls -lh "$OUT"
    ;;

  list)
    if [ -d "$BACKUPS_DIR" ]; then
      find "$BACKUPS_DIR" -type f -name 'typsy-*.db' -maxdepth 3 -print | sort
    else
      echo '(no backups directory)'
    fi
    ;;

  restore)
    backup_path="${1:-}"
    yes_flag="${2:-}"
    if [[ -z "$backup_path" || "$yes_flag" != "--yes" ]]; then
      echo "error: restore requires: scripts/prod-db.sh restore /path/to/backup.db --yes" >&2
      exit 1
    fi

    sudo bash -c "set -euo pipefail
TS=\$(date +%Y%m%d-%H%M%S)
DATA=\"$DATA\"
LIVE=\"$LIVE_DB\"
BAK=\"$backup_path\"

if [ ! -f \"\$BAK\" ]; then
  echo \"missing backup: \$BAK\" >&2
  exit 1
fi

sqlite3 \"\$BAK\" \"PRAGMA integrity_check\" | grep -qx ok

systemctl stop typsy

cp -av \"\$LIVE\" \"\$LIVE.preswap-\$TS\"
rm -fv \"\$LIVE-wal\" \"\$LIVE-shm\" || true

install -o natha -g natha -m 644 \"\$BAK\" \"\$LIVE\"

systemctl start typsy
sleep 2
systemctl is-active typsy

echo restored_from=\"\$BAK\"
echo preswap=\"\$LIVE.preswap-\$TS\""
    ;;

  *)
    echo "usage: scripts/prod-db.sh {backup|list|restore}" >&2
    exit 1
    ;;
esac
