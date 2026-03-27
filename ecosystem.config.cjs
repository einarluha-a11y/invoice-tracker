module.exports = {
  apps: [
    {
      name: 'invoice-api',
      script: './automation/api_server.cjs',
      watch: true,
      ignore_watch: ['node_modules', 'automation/logs', 'automation/dlq', '*.json', '*.flag']
    },
    {
      name: 'invoice-imap',
      script: './automation/imap_daemon.cjs',
      watch: true,
      ignore_watch: ['node_modules', 'automation/logs', 'automation/dlq', '*.json', '*.flag']
    },
    {
      name: 'invoice-dlq-cron',
      script: './automation/dlq_retry.cjs',
      cron_restart: '0 0,6,12,18 * * *', // Run every 6 hours
      autorestart: false,
      exec_mode: 'fork'
    }
  ]
};
