#!/usr/bin/env bash
# Stop the local stack started by dev-up.sh (and any leftover watchers).
pkill -f "[t]sx/dist/cli.mjs watch" || true
pkill -f "[s]rc/main.ts" || true
pkill -f "[n]ext dev" || true
pkill -f "[u]vicorn app.main" || true
pkill -f "[f]orge-runtime" || true
echo "stack stopped"
