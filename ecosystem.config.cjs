module.exports = {
  apps: [
    {
      name: 'invoice-bot',
      script: './automation/index.js',
      watch: ['./automation'],
      ignore_watch: [
        'node_modules', 
        '*.log', 
        '*.tmp', 
        '.env', 
        'google-credentials.json'
      ],
      // Watch options specifically tailored for MacOS/Windows stability
      watch_options: {
        followSymlinks: false
      },
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      }
    }
  ]
};
