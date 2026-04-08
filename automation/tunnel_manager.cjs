#!/usr/bin/env node
/**
 * Tunnel Manager — запускает cloudflared quick tunnel и обновляет GitHub webhook URL.
 * PM2 процесс — перезапускается при падении, автообновляет webhook.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env'), override: true });
const { spawn, execSync } = require('child_process');
const fs = require('fs');

const PORT = process.env.WEBHOOK_PORT || 3001;
const GITHUB_REPO = 'einarluha-a11y/invoice-tracker';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || '';
const WEBHOOK_URL_FILE = '/tmp/.tunnel_url';

function log(msg) {
    console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`);
}

function updateGitHubWebhook(tunnelUrl) {
    const webhookUrl = `${tunnelUrl}/pipeline`;
    log(`🔗 Tunnel URL: ${webhookUrl}`);

    // Save URL to file for other processes
    fs.writeFileSync(WEBHOOK_URL_FILE, webhookUrl);

    try {
        // List existing webhooks
        const hooks = JSON.parse(execSync(
            `gh api repos/${GITHUB_REPO}/hooks`,
            { encoding: 'utf-8', timeout: 10000 }
        ));

        // Delete old pipeline webhooks
        for (const hook of hooks) {
            if (hook.config?.url?.includes('/pipeline')) {
                execSync(`gh api repos/${GITHUB_REPO}/hooks/${hook.id} --method DELETE`, { timeout: 10000, stdio: 'pipe' });
                log(`🗑️ Deleted old webhook ${hook.id}`);
            }
        }
    } catch (e) {
        log(`⚠️ Failed to clean old webhooks: ${e.message.slice(0, 100)}`);
    }

    // Create new webhook with current tunnel URL
    try {
        const payload = JSON.stringify({
            name: 'web',
            active: true,
            events: ['push'],
            config: {
                url: webhookUrl,
                content_type: 'json',
                secret: WEBHOOK_SECRET,
            }
        });
        execSync(
            `gh api repos/${GITHUB_REPO}/hooks --method POST --input -`,
            { input: payload, timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
        );
        log(`✅ GitHub webhook created: ${webhookUrl}`);
    } catch (e) {
        log(`❌ Failed to create webhook: ${e.message.slice(0, 100)}`);
    }
}

// Start cloudflared
log('Starting cloudflared tunnel...');

const cf = spawn('cloudflared', ['tunnel', '--url', `http://localhost:${PORT}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' }
});

let tunnelUrl = '';

cf.stderr.on('data', (data) => {
    const line = data.toString();
    // Extract tunnel URL from cloudflared output
    const match = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && match[0] !== tunnelUrl) {
        tunnelUrl = match[0];
        updateGitHubWebhook(tunnelUrl);
    }
});

cf.on('close', (code) => {
    log(`❌ cloudflared exited with code ${code} — PM2 will restart`);
    process.exit(1); // PM2 restarts
});

cf.on('error', (err) => {
    log(`❌ cloudflared error: ${err.message}`);
    process.exit(1);
});

// Keep alive
setInterval(() => {}, 60000);
