module.exports = {
  apps: [
    {
      name: 'invoice-api',
      script: './automation/api_server.cjs',
      watch: true,
      ignore_watch: ['node_modules', 'automation/logs', 'automation/dlq', '*.json', '*.flag', '*.log'],
      restart_delay: 5000,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '500M',
      error_file: './automation/logs/invoice-api-error.log',
      out_file: './automation/logs/invoice-api-out.log',
    },
    {
      name: 'invoice-imap',
      script: './automation/imap_daemon.cjs',
      watch: true,
      ignore_watch: ['node_modules', 'automation/logs', 'automation/dlq', '*.json', '*.flag', '*.log'],
      restart_delay: 5000,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '1G',
      error_file: './automation/logs/invoice-imap-error.log',
      out_file: './automation/logs/invoice-imap-out.log',
    }
    // NOTE: invoice-dlq-cron removed — imap_daemon.cjs now calls processDLQ() after every
    // poll cycle (every 5 min), making a separate PM2 cron process redundant.
  ]
};
