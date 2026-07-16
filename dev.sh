#!/usr/bin/env bash
# .zscripts/dev.sh — flkr launcher, invoked by /start.sh on container boot.
#
# The platform's start.sh runs `sudo -u z bash .zscripts/dev.sh` in the
# background when this file exists. We use it to:
#   1. Install backend deps (idempotent).
#   2. Seed the SQLite DB from the canonical dataset (idempotent).
#   3. Start the Express backend on port 3000 (the port Caddy proxies to).
#
# The process is kept in the foreground of this script so the platform's
# process supervisor treats it as a long-running service.
set -euo pipefail

cd /home/z/my-project

echo "[flkr-dev] installing backend deps (if needed)"
if [ ! -d backend/node_modules ]; then
  (cd backend && npm install --no-audit --no-fund --loglevel=error)
fi

echo "[flkr-dev] seeding DB (idempotent)"
(cd backend && node seed.js) || echo "[flkr-dev] seed skipped (already populated or non-fatal error)"

echo "[flkr-dev] starting flkr backend on :3000"
export PORT=3000
export NODE_ENV=production
exec node backend/server.js
