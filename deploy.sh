#!/bin/bash
set -euo pipefail

# YM Global Deploy Script
# Deploys code ONLY — never touches database files on the server

SERVER="ubuntu@54.70.53.108"
KEY="$HOME/.ssh/SHIPSOURCED.pem"
REMOTE_DIR="/home/ubuntu/ym-global"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== YM Global Deploy ==="
echo "Local:  $LOCAL_DIR"
echo "Remote: $SERVER:$REMOTE_DIR"
echo ""

# Safety check: ensure we're in the right directory
if [ ! -f "$LOCAL_DIR/src/lib/db.ts" ]; then
  echo "ERROR: Not in ym-global project directory!"
  exit 1
fi

# Step 1: rsync code only — EXCLUDE ALL DATABASE FILES
echo "[1/3] Syncing code (excluding DB files, node_modules, .next, .env)..."
rsync -avz \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='.env' \
  --exclude='*.db' \
  --exclude='*.db-wal' \
  --exclude='*.db-shm' \
  --exclude='*.db-journal' \
  --exclude='*.db.backup-*' \
  --exclude='*.db.corrupt*' \
  -e "ssh -i $KEY" \
  "$LOCAL_DIR/" "$SERVER:$REMOTE_DIR/"

# Step 2: Build on server
echo ""
echo "[2/3] Building on server..."
ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && npm run build"

# Step 3: Restart PM2
echo ""
echo "[3/3] Restarting PM2..."
ssh -i "$KEY" "$SERVER" "pm2 restart ym-global"

echo ""
echo "=== Deploy complete ==="
echo "Verify: https://54.70.53.108/"
