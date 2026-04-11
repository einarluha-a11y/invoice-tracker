#!/usr/bin/env node
/**
 * Orphan cleanup — find Dropbox files that have no corresponding Firestore
 * invoice (M3).
 *
 * An "orphan" is a PDF in Dropbox whose path is not referenced by any
 * `invoices.dropboxPath` field in Firestore. Orphans typically come from:
 *   - failed Firestore writes after a successful Dropbox upload (race window)
 *   - manual uploads to Dropbox by accountants outside the pipeline
 *   - test runs that wrote files but never persisted to Firestore
 *
 * They waste storage and confuse audits — accountants see files in Dropbox
 * for invoices that don't exist in the dashboard. This script lists or
 * deletes them.
 *
 * Usage:
 *   node automation/orphan_cleanup.cjs                    # dry run, list only
 *   node automation/orphan_cleanup.cjs --delete           # actually delete
 *   node automation/orphan_cleanup.cjs --company IDEACOM  # only one tenant
 *
 * Designed to run weekly via cron in Railway. Safe to re-run — idempotent.
 *
 * Output report:
 *   - total files scanned in Dropbox
 *   - total Firestore invoices with dropboxPath
 *   - orphans found (path + size + lastModified)
 *   - deleted (only when --delete passed)
 */

require('dotenv').config({ path: __dirname + '/.env' });

const { db } = require('./core/firebase.cjs');
const { listInvoicesInFolder, buildDropboxFolderPath, resolveDropboxConfig } = require('./dropbox_service.cjs');

// Hard cap so a runaway script can't enumerate millions of Dropbox entries
const MAX_FOLDERS_PER_RUN = 200;
const MAX_ORPHANS_PER_RUN = 500;

async function deleteFromDropbox(path) {
    const { default: fetch } = await import('node-fetch');
    const { getAccessToken } = require('./dropbox_service.cjs');
    const token = await getAccessToken();
    const res = await fetch('https://api.dropboxapi.com/2/files/delete_v2', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ path }),
    });
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Dropbox delete failed: ${JSON.stringify(err)}`);
    }
    return true;
}

/**
 * Main orphan cleanup function — exported for in-process calls from
 * status_sweeper.cjs and as a CLI entrypoint when run directly.
 *
 * @param {object} opts
 * @param {boolean} opts.dryRun        — only list, don't delete (default true)
 * @param {string}  opts.companyFilter — substring match on company name
 * @returns {Promise<{scanned: number, orphans: number, deleted: number, failed: number}>}
 */
async function runOrphanCleanup({ dryRun = true, companyFilter = null } = {}) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`ORPHAN CLEANUP ${dryRun ? '(DRY RUN)' : '(LIVE — DELETING)'}`);
    console.log(`${'═'.repeat(60)}\n`);

    // 1. Build the set of all dropboxPath values referenced by Firestore invoices
    console.log('Step 1: Loading invoices from Firestore...');
    const snap = await db.collection('invoices').get();
    const knownPaths = new Set();
    let invoicesWithPath = 0;
    snap.forEach(doc => {
        const d = doc.data();
        if (d.dropboxPath) {
            knownPaths.add(d.dropboxPath.toLowerCase());
            invoicesWithPath++;
        }
    });
    console.log(`  Loaded ${snap.size} invoices, ${invoicesWithPath} have dropboxPath\n`);

    // 2. Walk Dropbox folders for each company that has been used recently
    console.log('Step 2: Loading companies + their Dropbox config...');
    const compSnap = await db.collection('companies').get();
    const companies = [];
    compSnap.forEach(doc => {
        const data = doc.data();
        if (companyFilter && !((data.name || '').toLowerCase().includes(companyFilter.toLowerCase()))) {
            return;
        }
        const cfg = resolveDropboxConfig(data.name, data);
        companies.push({ id: doc.id, name: data.name, cfg });
    });
    console.log(`  ${companies.length} companies to scan${companyFilter ? ` (filter: ${companyFilter})` : ''}\n`);

    // 3. For each company, scan recent Dropbox folders (current and previous month)
    //    Going further back is unnecessary — older months are stable.
    console.log('Step 3: Scanning Dropbox folders...');
    const orphans = [];
    let foldersScanned = 0;
    let filesScanned = 0;

    const now = new Date();
    const months = [
        { year: now.getFullYear(), month: now.getMonth() + 1 },                  // current
        {
            year: now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(),
            month: now.getMonth() === 0 ? 12 : now.getMonth(),
        },                                                                         // previous
    ];

    for (const company of companies) {
        if (foldersScanned >= MAX_FOLDERS_PER_RUN) break;
        for (const { year, month } of months) {
            if (foldersScanned >= MAX_FOLDERS_PER_RUN) break;
            const folderPath = buildDropboxFolderPath(company.name, String(year), String(month), { dropboxConfig: company.cfg });
            foldersScanned++;
            try {
                const entries = await listInvoicesInFolder(folderPath);
                if (entries.length === 0) continue;
                console.log(`  ${folderPath} → ${entries.length} files`);
                for (const entry of entries) {
                    if (entry['.tag'] !== 'file') continue;
                    filesScanned++;
                    const fullPath = entry.path_display || entry.path_lower;
                    if (!knownPaths.has(fullPath.toLowerCase())) {
                        orphans.push({
                            path: fullPath,
                            size: entry.size,
                            modified: entry.client_modified || entry.server_modified,
                            company: company.name,
                        });
                        if (orphans.length >= MAX_ORPHANS_PER_RUN) break;
                    }
                }
            } catch (e) {
                // Folder might not exist yet — that's fine for current month
                if (!String(e.message).includes('not_found')) {
                    console.warn(`  ⚠️  ${folderPath}: ${e.message}`);
                }
            }
        }
    }

    // 4. Report
    console.log(`\n${'─'.repeat(60)}`);
    console.log(`Folders scanned: ${foldersScanned}`);
    console.log(`Files scanned:   ${filesScanned}`);
    console.log(`Orphans found:   ${orphans.length}`);
    console.log(`${'─'.repeat(60)}\n`);

    if (orphans.length === 0) {
        console.log('✅ No orphans — Dropbox and Firestore are in sync.\n');
        return { scanned: filesScanned, orphans: 0, deleted: 0, failed: 0 };
    }

    // List orphans
    console.log('ORPHANS:');
    for (const o of orphans) {
        console.log(`  ${o.path}  (${(o.size / 1024).toFixed(1)} KB, ${o.modified}, ${o.company})`);
    }

    if (dryRun) {
        console.log(`\nDRY RUN — pass --delete to remove these from Dropbox.`);
        return { scanned: filesScanned, orphans: orphans.length, deleted: 0, failed: 0 };
    }

    // 5. Delete (live mode)
    console.log(`\nDeleting ${orphans.length} orphans...`);
    let deleted = 0;
    let failed = 0;
    for (const o of orphans) {
        try {
            await deleteFromDropbox(o.path);
            console.log(`  ✓ ${o.path}`);
            deleted++;
        } catch (e) {
            console.warn(`  ✗ ${o.path}: ${e.message}`);
            failed++;
        }
    }
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`Deleted: ${deleted}, Failed: ${failed}`);
    console.log(`${'═'.repeat(60)}\n`);
    return { scanned: filesScanned, orphans: orphans.length, deleted, failed };
}

module.exports = { runOrphanCleanup };

// CLI entrypoint
if (require.main === module) {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--delete');
    const companyFilter = (() => {
        const i = args.indexOf('--company');
        return i !== -1 ? args[i + 1] : null;
    })();
    runOrphanCleanup({ dryRun, companyFilter })
        .then(r => process.exit(r.failed > 0 ? 1 : 0))
        .catch(err => {
            console.error('FATAL:', err);
            process.exit(1);
        });
}
