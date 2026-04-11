require('dotenv').config({ path: __dirname + '/.env' });

// Startup env-var self-check (Minor). Warns on missing required vars.
// IMAP daemon needs Claude + Azure + Firebase to do useful work. We don't
// process.exit() because the watchdog would flap us — better to log
// loudly on startup so the operator sees the issue in Railway logs.
const { ensureEnv } = require('./core/env_check.cjs');
ensureEnv('imap_daemon', { exitOnFail: false });

// Global error handlers — prevent crashes from unhandled rejections / protocol error events
process.on('unhandledRejection', (reason, promise) => {
    const msg = (reason instanceof Error) ? reason.message : String(reason ?? 'unknown');
    console.error('[imap-daemon] ⚠️  Unhandled rejection (not crashing):', msg);
});
process.on('uncaughtException', (err) => {
    const msg = (err instanceof Error) ? err.message : String(err ?? 'unknown');
    console.error('[imap-daemon] ⚠️  Uncaught exception (not crashing):', msg);
});
process.on('exit', (code) => {
    // Log ALL exits — including clean 0 exits that may indicate event-loop drain.
    console.error('[imap-daemon] 🔴 Process exiting with code', code);
});
// SIGTERM handler: PM2 sends SIGTERM on restart/stop. Logging distinguishes intentional
// restarts (SIGTERM → code 0) from unexpected event-loop drain (code 0, no signal log).
process.on('SIGTERM', () => {
    console.error('[imap-daemon] 🟡 Received SIGTERM — PM2 restart/stop, exiting cleanly');
    process.exit(0);
});

// Keepalive: prevents event-loop drain when all IMAP accounts are rate-limited
// and async ops complete too fast (Firebase calls return immediately on network flap).
// Without this: event loop empties → Node exits (code 0) → PM2 restarts → crash loop.
// Use 5s interval (not 60s) so the first timer fires well before pollLoop/auditLoop
// timers are created — closing the crash-loop window that existed in the first 60s.
const _keepAlive = setInterval(() => {}, 5000);

// Modules
const { checkEmailForInvoices, pollAllCompanyInboxes, checkAndRunFlagTasks, pollLoop, loadRateLimitsFromFirestore } = require('./imap_listener.cjs');
const { writeToFirestore, parseInvoiceDataWithAI, scoutTeacherPipeline } = require('./invoice_processor.cjs');
const { reconcilePayment, processBankStatement } = require('./bank_statement_processor.cjs');
const { sweepStatuses, auditLoop } = require('./status_sweeper.cjs');

// Start the process only when run directly (not when imported as a module)
if (require.main === module) {
    // CRITICAL: .catch() ensures pollLoop/auditLoop always start even if flag tasks fail.
    // Without it: checkAndRunFlagTasks() rejection → unhandledRejection handler logs it
    // → pollLoop never called → event loop empty → Node exits → PM2 restarts → crash loop.
    console.error('[imap-daemon] 🟢 Startup: running flag tasks');
    checkAndRunFlagTasks()
        .catch(err => {
            // Use safe stringify — err may be null/non-Error (same pattern as unhandledRejection handler).
            // If .catch() itself throws, .then() is never called → pollLoop never starts → crash loop.
            const msg = (err instanceof Error) ? err.message : String(err ?? 'unknown');
            console.error('[imap-daemon] ⚠️  Flag tasks failed (non-fatal, starting loops anyway):', msg);
        })
        .then(async () => {
            // Restore IMAP bans from Firestore before first poll.
            // Local file is ephemeral on Railway — Firestore is the only source of truth
            // that survives container restarts. Without this, rate-limited accounts would
            // be retried immediately on each restart, causing the crash loop.
            // Timeout guard: if Firestore hangs, don't block pollLoop forever.
            // Use a flag so we only warn if Firestore truly didn't respond — not when it
            // responds at the same instant the timer fires (race condition on Railway cold start).
            console.error('[imap-daemon] 🟢 Startup: restoring rate limits from Firestore');
            const RESTORE_TIMEOUT_MS = 30000;
            let _firestoreResolved = false;
            await Promise.race([
                loadRateLimitsFromFirestore().then(r => { _firestoreResolved = true; return r; }),
                new Promise(resolve => {
                    setTimeout(() => {
                        if (!_firestoreResolved) {
                            console.warn('[imap-daemon] ⚠️  loadRateLimitsFromFirestore timed out — starting loops anyway');
                        }
                        resolve();
                    }, RESTORE_TIMEOUT_MS);
                }),
            ]);
            // Self-healing wrappers: if a loop exits for any reason (uncaught throw
            // before first await, or unhandled rejection), restart it after 30s rather
            // than leaving the daemon silent until the next PM2 restart.
            console.error('[imap-daemon] 🟢 Startup: starting pollLoop and auditLoop');
            (async () => {
                while (true) {
                    try { await pollLoop(); } catch (e) {
                        console.error('[imap-daemon] ⚠️  pollLoop exited unexpectedly, restarting in 30s:', e?.message || e);
                    }
                    await new Promise(r => setTimeout(r, 30000));
                }
            })();
            (async () => {
                while (true) {
                    try { await auditLoop(); } catch (e) {
                        console.error('[imap-daemon] ⚠️  auditLoop exited unexpectedly, restarting in 30s:', e?.message || e);
                    }
                    await new Promise(r => setTimeout(r, 30000));
                }
            })();
            console.error('[imap-daemon] 🟢 Startup complete — daemon running');
        });
}

module.exports = { checkEmailForInvoices, parseInvoiceDataWithAI, writeToFirestore, reconcilePayment, pollAllCompanyInboxes };
