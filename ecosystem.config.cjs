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
    }
    // NOTE: invoice-dlq-cron removed — imap_daemon.cjs now calls processDLQ() after every
    // poll cycle (every 5 min), making a separate PM2 cron process redundant.
  ]
};
