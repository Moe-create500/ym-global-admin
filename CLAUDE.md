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

## Deploy
```bash
./deploy.sh
```

## Sync
- Auto-sync runs every 30 min via `src/instrumentation.ts`
- Manual: `curl http://localhost:3001/api/cron/sync` (no auth)
- FB ad spend: pulled from Insights API → `ad_spend` table → rolled into `daily_pnl.ad_spend_cents`
