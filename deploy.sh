#!/bin/bash
set -euo pipefail

# YM Global Deploy Script
# Deploys code ONLY — never touches database files on the server
# GITHUB SYNC: Always pulls partner's creatives + pushes your changes

SERVER="ubuntu@54.70.53.108"
KEY="$HOME/.ssh/SHIPSOURCED.pem"
REMOTE_DIR="/home/ubuntu/ym-global"
LOCAL_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO="https://github.com/Moe-create500/ym-global-admin.git"

echo "=== YM Global Deploy ==="
echo "Local:  $LOCAL_DIR"
echo "Remote: $SERVER:$REMOTE_DIR"
echo "Repo:   $REPO"
echo ""

# Safety check: ensure we're in the right directory
if [ ! -f "$LOCAL_DIR/src/lib/db.ts" ]; then
  echo "ERROR: Not in ym-global project directory!"
  exit 1
fi

cd "$LOCAL_DIR"

# Step 0a: Pull latest from GitHub (gets partner's creative changes)
echo "[0/4] Pulling partner's latest changes from GitHub..."
git pull origin main --no-edit
echo ""

# Step 0b: Commit and push your local changes to GitHub
echo "[1/4] Pushing your changes to GitHub..."
git add -A
if git diff --cached --quiet; then
  echo "No new changes to push."
else
  git commit -m "deploy: $(date '+%Y-%m-%d %H:%M:%S')"
  git push origin main
fi
echo ""

# Step 2: rsync code only — EXCLUDE ALL DATABASE FILES
echo "[2/4] Syncing code to server (excluding DB files, node_modules, .next, .env)..."
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
  --exclude='database.sqlite' \
  -e "ssh -i $KEY" \
  "$LOCAL_DIR/" "$SERVER:$REMOTE_DIR/"

# Step 3: Build on server
echo ""
echo "[3/4] Building on server..."
ssh -i "$KEY" "$SERVER" "cd $REMOTE_DIR && npm run build"

# Step 4: Restart PM2
echo ""
echo "[4/4] Restarting PM2..."
ssh -i "$KEY" "$SERVER" "pm2 restart ym-global"

echo ""
echo "=== Deploy complete ==="
echo "GitHub synced + Server deployed"
echo "Verify: https://54.70.53.108/"
