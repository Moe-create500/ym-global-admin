module.exports = {
  apps: [{
    name: 'ym-global',
    cwd: '/home/ubuntu/ym-global',
    script: 'npm',
    args: 'start -- -p 3001',
    interpreter: 'none',
    env: {
      NODE_ENV: 'production',
      NODE_OPTIONS: '--max-old-space-size=2048',
      PORT: '3001',
    },
    max_memory_restart: '2800M',
    autorestart: true,
    max_restarts: 10,
    restart_delay: 3000,
    min_uptime: '10s',
    out_file: '/home/ubuntu/.pm2/logs/ym-global-out.log',
    error_file: '/home/ubuntu/.pm2/logs/ym-global-error.log',
    merge_logs: true,
  }],
};
