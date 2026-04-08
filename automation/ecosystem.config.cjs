module.exports = {
  apps: [
    {
      name: 'invoice-api',
      script: './api_server.cjs',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'invoice-imap',
      script: './imap_daemon.cjs',
      max_restarts: 10,
      restart_delay: 5000,
      exp_backoff_restart_delay: 100,
    },
    {
      name: 'merit-aktiva-agent',
      script: './merit_aktiva_agent.cjs',
      cron_restart: '0 9 * * *',
      autorestart: false,
      watch: false,
    },
  ]
};
