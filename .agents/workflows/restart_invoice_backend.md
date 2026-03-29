---
description: How to restart the Invoice-Tracker backend
---
1. Check if the Node server is running with `ps aux` and kill it to apply changes.
// turbo-all
2. Run `pkill -f "pollAllCompanyInboxes"` to terminate the background process.
3. The desktop app `Invoice-Tracker.app` contains a script `InvoiceTracker` that automatically restarts this process when the app is launched. If it needs to be launched manually, run `cd automation && PORT=3001 node -e "require('./index.js').pollAllCompanyInboxes()"` in the background.
