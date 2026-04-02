module.exports = {
  apps: [
    {
      name: 'invoice-api',
      script: './api_server.cjs',
    },
    {
      name: 'invoice-imap',
      script: './imap_daemon.cjs',
    }
  ]
};
