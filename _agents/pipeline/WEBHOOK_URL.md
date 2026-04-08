# Pipeline Webhook URL

## Active Tunnel
https://weeks-slots-gently-likewise.trycloudflare.com/pipeline

## Note
This is a Cloudflare Quick Tunnel (temporary, no account required).
URL changes on each `cloudflared` restart.

## Setup
- PM2 process: `pipeline-webhook` (port 3001)
- GitHub webhook ID: 605082436
- Repo: einarluha-a11y/invoice-tracker
- Events: push

## To restart tunnel
```bash
cloudflared tunnel --url http://localhost:3001 --no-autoupdate --protocol http2 &
```
Then update GitHub webhook URL via:
```bash
gh api repos/einarluha-a11y/invoice-tracker/hooks/605082436 -X PATCH -f "config[url]=<NEW_URL>/pipeline"
```
