#!/usr/bin/env bash
# scripts/prod-db.sh — helper for backing up / listing / restoring the production SQLite DB.
#
# Usage:
#   scripts/prod-db.sh backup
#   scripts/prod-db.sh list
#   scripts/prod-db.sh restore /absolute/path/to/backup.db --yes
#
# Notes:
# - Backups are created via `sqlite3 .backup` on the server (online, WAL-safe).
# - Backups are stored under $DATA/backups/YYYY/MM/ with timestamped filenames.
# - Restore is DESTRUCTIVE and requires --yes.

set -euo pipefail

HOST="${TYPSY_SSH_HOST:-natha@ssh.cal.taxi}"
REMOTE_REPO="${TYPSY_REMOTE_REPO:-/home/natha/Programming/typsy}"
DATA="$REMOTE_REPO/apps/server/data"

cmd="${1:-}"
shift || true

case "$cmd" in
  backup)
    ssh "$HOST" "set -euo pipefail; TS=\$(date +%Y%m%d-%H%M%S); BKDIR=\"$DATA/backups/\$(date +%Y)/\$(date +%m)\"; mkdir -p \"\$BKDIR\"; OUT=\"\$BKDIR/typsy-\$TS.db\"; sqlite3 \"$DATA/typsy.db\" \".backup \$OUT\"; sqlite3 \"\$OUT\" \"PRAGMA integrity_check\"; echo \"backup=\$OUT\"; ls -lh \"\$OUT\"" ;;

  list)
    ssh "$HOST" "set -euo pipefail; if [ -d \"$DATA/backups\" ]; then find \"$DATA/backups\" -type f -name 'typsy-*.db' -maxdepth 3 -print | sort; else echo '(no backups directory)'; fi" ;;

  restore)
    backup_path="${1:-}"
    yes_flag="${2:-}"
    if [[ -z "$backup_path" || "$yes_flag" != "--yes" ]]; then
      echo "error: restore requires: scripts/prod-db.sh restore /path/to/backup.db --yes" >&2
      exit 1
    fi

    ssh -t "$HOST" "sudo bash -c 'set -euo pipefail; TS=\$(date +%Y%m%d-%H%M%S); DATA=\"$DATA\"; BAK=\"$backup_path\"; if [ ! -f \"\$BAK\" ]; then echo \"missing backup: \$BAK\" >&2; exit 1; fi; sqlite3 \"\$BAK\" \"PRAGMA integrity_check\" | grep -qx ok; systemctl stop typsy; cp -av \"\$DATA/typsy.db\" \"\$DATA/typsy.db.preswap-\$TS\"; rm -fv \"\$DATA/typsy.db-wal\" \"\$DATA/typsy.db-shm\"; install -o natha -g natha -m 644 \"\$BAK\" \"\$DATA/typsy.db\"; systemctl start typsy; sleep 2; systemctl is-active typsy; echo restored_from=\"\$BAK\"; echo preswap=\"\$DATA/typsy.db.preswap-\$TS\"'" ;;

  *)
    echo "usage: scripts/prod-db.sh {backup|list|restore}" >&2
    exit 1
    ;;
esac
