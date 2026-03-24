const fs = require('fs');
const { execSync, exec } = require('child_process');
const path = require('path');

const DIR_TO_WATCH = __dirname;
let lastUptime = 0;
let watchTimeout = null;

// Initialize base uptime from PM2 to establish a baseline
function getInvoiceBotUptime() {
    try {
        const pm2List = JSON.parse(execSync('pm2 jlist', { encoding: 'utf-8' }));
        const target = pm2List.find(proc => proc.name === 'invoice-bot');
        if (target) return target.pm2_env.pm_uptime;
    } catch (e) { }
    return null;
}

lastUptime = getInvoiceBotUptime() || Date.now();
console.log(`👁️ Overseer Agent activated. Monitoring [${DIR_TO_WATCH}] for code mutations...`);

function triggerAgony() {
    console.log("⚡ OVERSEER INTERVENTION ⚡: Code mutation detected without a subsequent memory refresh!");
    console.log("Halting the 'invoice-bot' process to prevent execution with corrupted/stale memory.");
    console.log("COMMAND TO AI AGENT: Execute `pm2 restart invoice-bot` immediately to clear the violation.");
    
    // The Overseer selectively halts ONLY the backend node to prevent stale execution
    try { 
        execSync('pm2 stop invoice-bot'); 
    } catch(e) {}
}

fs.watch(DIR_TO_WATCH, { recursive: true }, (eventType, filename) => {
    if (!filename || (!filename.endsWith('.cjs') && !filename.endsWith('.js'))) return;
    if (filename.includes('overseer_agent')) return;

    clearTimeout(watchTimeout);
    watchTimeout = setTimeout(() => {
        console.log(`[Overseer] Mutation detected in <${filename}>. 3-second obedience window opened...`);
        
        setTimeout(() => {
            const currentUptime = getInvoiceBotUptime();
            if (currentUptime && currentUptime > lastUptime) {
                console.log("✅ [Overseer] Compliance verified. Server was successfully rebooted.");
                lastUptime = currentUptime;
            } else {
                triggerAgony();
            }
        }, 3500); 

    }, 500);
});
