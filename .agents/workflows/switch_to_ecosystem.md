---
description: Switch PM2 to ecosystem.config.cjs so backend auto-restarts when files change
---
// turbo-all
1. Run `cd /Users/einarluha/Downloads/invoice-tracker && pm2 delete invoice-bot` to stop the current process.
2. Run `pm2 start ecosystem.config.cjs` to start with watch mode enabled.
3. Run `pm2 save` to persist the configuration.
4. Run `pm2 list` to confirm invoice-bot is online and watch mode is active.
