module.exports = {
  apps: [{
    name: 'ym-global',
    cwd: '/home/ubuntu/ym-global',
    script: 'node_modules/.bin/next',
    args: 'start -p 3001',
    env: {
      NODE_ENV: 'production',
      // Machine has 1.9GB RAM. Cap V8 heap well under that so it GCs instead of
      // hard-crashing, and let PM2 (max_memory_restart below) be the real safety net.
      NODE_OPTIONS: '--max-old-space-size=1280',
      PORT: '3001',
    },
    // Restart cleanly at 1.45GB RSS — before the machine exhausts RAM+swap and V8 OOMs.
    max_memory_restart: '1450M',
    autorestart: true,
    max_restarts: 15,
    restart_delay: 3000,
    min_uptime: '10s',
    out_file: '/home/ubuntu/.pm2/logs/ym-global-out.log',
    error_file: '/home/ubuntu/.pm2/logs/ym-global-error.log',
    merge_logs: true,
  }],
};
