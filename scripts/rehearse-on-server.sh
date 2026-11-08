#!/usr/bin/env bash
# ForgeERP — run the staging migration rehearsal ON THE SERVER, against the
# newest pre-deploy dump. Production data never leaves the host, and the live
# database is never written: the dump is loaded into a separate rehearsal
# database (see scripts/staging-rehearsal.mjs for every safety rule).
#
# Run as the site user, from anywhere:
#   bash rehearse-on-server.sh                      # creates + drops <live_db>_rehearsal
#   REHEARSAL_DB=erp_rehearsal bash rehearse-on-server.sh --use-empty
#       (CloudPanel: create the empty database erp_rehearsal for the SAME db
#        user first, because site DB users usually cannot CREATE DATABASE)
#
# Env overrides: APP (site dir), DUMP (dump file), REPO (git url), REF (branch).
set -euo pipefail
SITE_HOME=${HOME}
APP=${APP:-$SITE_HOME/htdocs/www.erp.lastrivon.cloud}
REPO=${REPO:-https://github.com/akashshinde700/erp.git}
REF=${REF:-main}
WORK=$SITE_HOME/tmp/rehearsal-src
export NVM_DIR="$SITE_HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"

DUMP=${DUMP:-$(ls -1t "$SITE_HOME"/backups/predeploy/*.sql.gz 2>/dev/null | head -1 || true)}
[ -n "$DUMP" ] && [ -f "$DUMP" ] || { echo "no dump in $SITE_HOME/backups/predeploy (or DUMP not found)"; exit 2; }
echo "dump: $DUMP"

# current code (migrations + rehearsal script), outside the live site
if [ -d "$WORK/.git" ]; then git -C "$WORK" fetch -q origin "$REF" && git -C "$WORK" checkout -q -f FETCH_HEAD
else rm -rf "$WORK"; git clone -q --depth 1 --branch "$REF" "$REPO" "$WORK"; fi
cd "$WORK"
echo "code: $(git log --oneline -1)"
npm ci --ignore-scripts --no-audit --no-fund >/dev/null
npx --no-install prisma generate >/dev/null

# rehearsal URL = live credentials, different (disposable) database name;
# built in-process and passed by environment, never printed
STAGING_DATABASE_URL=$(python3 - "$APP/.env" "${REHEARSAL_DB:-}" <<'PY'
import sys, urllib.parse
url = next(l.split("=", 1)[1].strip().strip('"').strip("'") for l in open(sys.argv[1]) if l.startswith("DATABASE_URL="))
u = urllib.parse.urlparse(url)
name = sys.argv[2] or (u.path.lstrip("/") + "_rehearsal")
print(u._replace(path="/" + name).geturl())
PY
)
export STAGING_DATABASE_URL
node scripts/staging-rehearsal.mjs "$DUMP" "$@"
