---
description: How to correctly deploy any code or UI changes across the local and cloud architecture.
---

# Unified Omnichannel Deployment Protocol

The "Invoice-Tracker" ecosystem operates on a highly decentralized architecture consisting of three distinct layers:
1. **The Core PM2 Daemon (`invoice-bot`)**: Handles IMAP scraping, AI ingestion, and Firebase synchronization locally.
2. **The Local Vite Desktop PWA (`http://localhost:5173/`)**: A Service Worker-cached UI running locally on the user's desktop engine.
3. **The Vercel Cloud Repository (`https://github.com/einarluha-a11y/invoice-tracker`)**: The ultimate source of truth serving the live Desktop wrapper GUI via the Edge.

Whenever an Agent modifies **anya** aspect of the frontend (`src/`) or the backend backend (`automation/`), it is absolutely **CRITICAL** that all three physical layers are synchronized.

**DO NOT execute fractional deployments (e.g. just restarting pm2 without a git push).**

To deploy your changes, you must run the unified macro from the root `invoice-tracker` directory:

```bash
npm run deploy
```

This single command will sequentially:
1. Recompile the Vite Production assets (`npm run build`) to break the Service Worker UI cache.
2. Restart the local backend AI daemon (`pm2 restart invoice-bot`) to reload modified JavaScript.
3. Track, commit (`chore(deploy): auto-sync full stack architecture`), and force-push all local artifacts to the GitHub remote (`git push`), triggering the Vercel cloud redeployment sequence.

Always use this method after completing a successful operational phase to prevent the user from experiencing divergent UI phenomena.
