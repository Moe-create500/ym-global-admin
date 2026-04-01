# YM Global Ventures — Project Instructions

## Stack
- Next.js 14 App Router + TypeScript + SQLite (better-sqlite3)
- Production: `ubuntu@54.70.53.108`, SSH key `~/.ssh/SHIPSOURCED.pem`
- PM2 app: `ym-global`, port 3001

## Database
- **App DB**: `prisma/dev.db` on server (configured in `src/lib/db.ts`)
- This is the ONLY database. Do NOT reference or use `/home/ubuntu/ym-data.db` (legacy, stale).

## CRITICAL DEPLOY RULES
1. **ALWAYS use `./deploy.sh`** to deploy — it excludes all DB files automatically
2. **NEVER rsync `*.db`, `*.db-wal`, `*.db-shm` files to the server** — this WILL corrupt the live database
3. **NEVER delete WAL/SHM files** on the server — they contain uncommitted transactions, deleting = data loss
4. **ALWAYS `pm2 stop ym-global` before copying/replacing any DB file** on the server
5. **ALWAYS backup before any DB operation**: `cp dev.db dev.db.backup-$(date +%Y%m%d-%H%M%S)`
6. **ALWAYS verify integrity**: `sqlite3 dev.db 'PRAGMA integrity_check;'`

## CRITICAL GITHUB / CREATIVES RULES
- **GitHub repo**: `https://github.com/Moe-create500/ym-global-admin`
- **Partner owns creatives**: Partner edits creative files directly on GitHub `main` and deploys from there
- **NEVER edit creative files** without explicit user approval:
  - `src/app/dashboard/creatives/` — partner's territory
  - `src/app/api/creatives/` — partner's territory
  - `src/app/api/batches/[id]/generate-creatives/` — partner's territory
- **ALWAYS `git pull origin main` before making ANY changes** — to get partner's latest creatives
- **ALWAYS `git add -A && git commit && git push origin main` after ANY changes** — so partner's next deploy includes your work
- **ALWAYS deploy via `./deploy.sh`** — it handles git pull, push, rsync, build, and restart automatically
- **NEVER deploy manually with rsync** — you WILL overwrite partner's creative changes
- **If there's a merge conflict in creative files**: STOP and ask the user. Do NOT resolve it yourself.

## Deploy
```bash
./deploy.sh
```
This script automatically: pulls from GitHub → commits & pushes your changes → rsyncs to server → builds → restarts PM2.

## Sync
- Auto-sync runs every 30 min via `src/instrumentation.ts`
- Manual: `curl http://localhost:3001/api/cron/sync` (no auth)
- FB ad spend: pulled from Insights API → `ad_spend` table → rolled into `daily_pnl.ad_spend_cents`
