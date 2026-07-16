#!/usr/bin/env bash
# flkr-watchdog.sh — keep flkr alive forever.
# Restarts the backend if it dies. Started with setsid + disown so it
# survives the tool-call shell exiting.
set -u
cd /home/z/my-project
export PORT=3000
export NODE_ENV=production

while true; do
  echo "[watchdog] $(date -u +%FT%TZ) starting flkr backend on :3000"
  node backend/server.js > /tmp/flkr.log 2>&1
  rc=$?
  echo "[watchdog] $(date -u +%FT%TZ) flkr exited rc=$rc — restarting in 2s"
  sleep 2
done
