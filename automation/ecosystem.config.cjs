module.exports = {
  apps: [
    {
      name: 'invoice-api',
      script: './api_server.cjs',
    },
    {
      name: 'invoice-imap',
      script: './imap_daemon.cjs',
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
