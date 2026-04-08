module.exports = {
  apps: [
    {
      name: 'invoice-api',
      script: './automation/api_server.cjs',
      watch: false,  // watch off — watchdog handles restarts, pm2 restart all for deploys
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
      watch: false,  // watch off — watchdog handles restarts, pm2 restart all for deploys
      restart_delay: 5000,
      max_restarts: 10,
      exp_backoff_restart_delay: 100,
      max_memory_restart: '1G',
      error_file: './automation/logs/invoice-imap-error.log',
      out_file: './automation/logs/invoice-imap-out.log',
    },
    // NOTE: invoice-dlq-cron removed — imap_daemon.cjs now calls processDLQ() after every
    // poll cycle (every 5 min), making a separate PM2 cron process redundant.
    {
      name: 'pipeline-monitor',
      script: './automation/pipeline_monitor.cjs',
      watch: false,  // no file watch — polls git every 30s (kept as fallback)
      restart_delay: 10000,
      max_restarts: 50,
      max_memory_restart: '200M',
      error_file: './automation/logs/pipeline-monitor-error.log',
      out_file: './automation/logs/pipeline-monitor-out.log',
    },
    {
      name: 'pipeline-webhook',
      script: './automation/webhook_receiver.cjs',
      watch: false,
      restart_delay: 3000,
      max_restarts: 10,
      max_memory_restart: '200M',
      env: {
        WEBHOOK_PORT: 3001,
      },
      error_file: './automation/logs/pipeline-webhook-error.log',
      out_file: './automation/logs/pipeline-webhook-out.log',
    },
    {
      name: 'watchdog',
      script: './automation/watchdog.cjs',
      watch: false,
      restart_delay: 30000,
      max_restarts: 100,
      max_memory_restart: '100M',
      error_file: './automation/logs/watchdog-error.log',
      out_file: './automation/logs/watchdog-out.log',
    }
  ]
};
