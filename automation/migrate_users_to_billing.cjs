#!/usr/bin/env node
/**
 * User migration — seed users/{uid}/billing/state for every existing
 * user so the billing system works on day 1 of rollout.
 *
 * Grandfather policy (confirmed with Einar):
 *   - Every existing user goes onto the FREE plan (50 credits/month)
 *   - Plus a ONE-TIME grant of 1000 "purchased" credits as a thank-you
 *     for being an early adopter. These roll over and never expire.
 *   - No 14-day PRO trial — existing users have already been using
 *     the product, starting and revoking a trial would be hostile.
 *   - Existing workflows never break: 1000 credits covers ~1000
 *     invoices at 1 credit/extraction, enough runway to evaluate
 *     whether to upgrade to PRO before hitting any real limit.
 *
 * Behavior:
 *   - Default is DRY RUN. Nothing writes to Firestore.
 *   - Pass --fix to actually create the billing docs.
 *   - Skips users who already have a billing doc (idempotent —
 *     safe to re-run).
 *   - Uses atomic .create() on each write so a race against the
 *     webhook handler never double-seeds.
 *
 * Usage:
 *   node automation/migrate_users_to_billing.cjs              # dry run
 *   node automation/migrate_users_to_billing.cjs --fix        # LIVE
 *   node automation/migrate_users_to_billing.cjs --limit 5    # cap for testing
 *
 * Exit codes:
 *   0 — success (dry or live)
 *   1 — Firebase unavailable or fatal error
 *   2 — partial failure (some writes failed, see logs)
 */

'use strict';

require('dotenv').config({ path: __dirname + '/.env' });

const { admin, db } = require('./core/firebase.cjs');
const { PLANS, getCreditsForPlan } = require('./core/billing.cjs');

const GRANDFATHER_BONUS = 1000;
const DAY_MS = 86400_000;

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--fix');
const limitArgIdx = args.indexOf('--limit');
const LIMIT = limitArgIdx !== -1 ? parseInt(args[limitArgIdx + 1], 10) : Infinity;

/**
 * Build the billing doc for an existing user. Pure function — no
 * Firestore access so it's trivially testable.
 *
 * @param {object} opts
 * @param {string} opts.uid
 * @param {string} opts.email
 * @param {number} [opts.now]
 * @returns {object}
 */
function buildMigrationDoc({ uid, email, now = Date.now() }) {
    return {
        uid,
        email: email || null,
        plan: PLANS.FREE,
        billingCycle: 'monthly',
        credits: {
            limit: getCreditsForPlan(PLANS.FREE),    // 50/month
            used: 0,
            purchased: GRANDFATHER_BONUS,             // 1000 one-time grant
            resetAt: now + 30 * DAY_MS,
        },
        trial: { active: false, endsAt: null },
        lemonSqueezy: { customerId: null, subscriptionId: null, variantId: null },
        migratedAt: now,
        migration: {
            grandfatherBonus: GRANDFATHER_BONUS,
            reason: 'existing_user_grandfather',
            policyVersion: 1,
        },
        createdAt: now,
        updatedAt: now,
    };
}

/**
 * Enumerate users by walking our Firestore schema, NOT Firebase Auth's
 * listUsers() API. Two reasons:
 *   1. The service account may lack the Firebase Authentication Admin
 *      role (by design — principle of least privilege).
 *   2. Our "users" = people actually present in the app's Firestore
 *      collections (master_users + accounts/{id}/users/{uid}).
 *      Anyone signed in via Firebase Auth but not in our schema is an
 *      orphan we don't want to seed billing for.
 *
 * Deduplicates by uid — a single human may appear both as a master user
 * AND inside an account.
 */
async function listAllUsers() {
    const byUid = new Map();

    // 1. master_users/*
    try {
        const masterSnap = await db.collection('master_users').get();
        for (const doc of masterSnap.docs) {
            if (byUid.size >= LIMIT) break;
            const data = doc.data() || {};
            byUid.set(doc.id, { uid: doc.id, email: data.email || '', source: 'master_users' });
        }
    } catch (err) {
        console.warn(`[Migration] Failed to read master_users: ${err.message}`);
    }

    // 2. accounts/{id}/users/{uid}
    try {
        const accountsSnap = await db.collection('accounts').get();
        for (const accountDoc of accountsSnap.docs) {
            if (byUid.size >= LIMIT) break;
            const usersSnap = await accountDoc.ref.collection('users').get();
            for (const userDoc of usersSnap.docs) {
                if (byUid.size >= LIMIT) break;
                if (byUid.has(userDoc.id)) continue; // already from master_users
                const data = userDoc.data() || {};
                byUid.set(userDoc.id, {
                    uid: userDoc.id,
                    email: data.email || '',
                    source: `accounts/${accountDoc.id}`,
                });
            }
        }
    } catch (err) {
        console.warn(`[Migration] Failed to read accounts/*/users: ${err.message}`);
    }

    return Array.from(byUid.values()).slice(0, LIMIT);
}

async function hasBillingDoc(uid) {
    const snap = await db
        .collection('users').doc(uid)
        .collection('billing').doc('state')
        .get();
    return snap.exists;
}

async function main() {
    if (!db) {
        console.error('[Migration] ❌ Firestore not initialized — check FIREBASE_SERVICE_ACCOUNT env var.');
        process.exit(1);
    }

    console.log('\n══════════════════════════════════════════════════');
    console.log('USER BILLING MIGRATION');
    console.log('══════════════════════════════════════════════════');
    console.log(`Mode:    ${DRY_RUN ? 'DRY RUN (pass --fix to write)' : 'LIVE'}`);
    console.log(`Policy:  FREE + ${GRANDFATHER_BONUS} grandfather credits`);
    console.log(`Limit:   ${LIMIT === Infinity ? 'none' : LIMIT}`);
    console.log('──────────────────────────────────────────────────\n');

    // Step 1: enumerate users
    console.log('Step 1: Loading users from Firebase Auth...');
    const users = await listAllUsers();
    console.log(`  Found ${users.length} users\n`);

    if (users.length === 0) {
        console.log('No users to migrate. Exiting.');
        process.exit(0);
    }

    // Step 2: classify — skip those who already have a billing doc
    console.log('Step 2: Checking existing billing docs...');
    const toMigrate = [];
    const alreadyMigrated = [];
    for (const user of users) {
        const exists = await hasBillingDoc(user.uid);
        if (exists) alreadyMigrated.push(user);
        else toMigrate.push(user);
    }
    console.log(`  Already migrated: ${alreadyMigrated.length}`);
    console.log(`  Will migrate:     ${toMigrate.length}\n`);

    if (toMigrate.length === 0) {
        console.log('✅ Everyone is already migrated. Nothing to do.');
        process.exit(0);
    }

    // Step 3: plan / execute
    console.log('Step 3: ' + (DRY_RUN ? 'Planning migration' : 'Executing migration'));
    console.log('──────────────────────────────────────────────────');
    console.log('UID                                Email                        Status');
    console.log('──────────────────────────────────────────────────────────────────────');

    let succeeded = 0;
    let failed = 0;
    for (const user of toMigrate) {
        const uidShort = user.uid.padEnd(32).slice(0, 32);
        const emailShort = (user.email || '(no email)').padEnd(28).slice(0, 28);
        const doc = buildMigrationDoc({ uid: user.uid, email: user.email });

        if (DRY_RUN) {
            console.log(`${uidShort} ${emailShort} WOULD CREATE (+${doc.credits.purchased} credits)`);
            succeeded++;
            continue;
        }

        try {
            await db
                .collection('users').doc(user.uid)
                .collection('billing').doc('state')
                .create(doc);
            console.log(`${uidShort} ${emailShort} CREATED`);
            succeeded++;
        } catch (err) {
            // ALREADY_EXISTS means a webhook raced us — not fatal
            const isAlreadyExists = err.code === 6 || /ALREADY_EXISTS/.test(String(err.message));
            if (isAlreadyExists) {
                console.log(`${uidShort} ${emailShort} ALREADY EXISTS (race)`);
                succeeded++;
            } else {
                console.log(`${uidShort} ${emailShort} FAILED — ${err.message}`);
                failed++;
            }
        }
    }

    console.log('──────────────────────────────────────────────────────────────────────');
    console.log(`\nSummary:`);
    console.log(`  Migrated: ${succeeded}`);
    console.log(`  Failed:   ${failed}`);
    console.log(`  Skipped:  ${alreadyMigrated.length}`);
    console.log();

    if (DRY_RUN) {
        console.log('DRY RUN complete. Re-run with --fix to apply.');
        process.exit(0);
    }

    if (failed > 0) {
        console.error(`⚠️  ${failed} migration(s) failed. Re-run to retry failed users (idempotent).`);
        process.exit(2);
    }

    console.log('✅ Migration complete.');
    process.exit(0);
}

// Export for tests, run as CLI if invoked directly
module.exports = { buildMigrationDoc, GRANDFATHER_BONUS };

if (require.main === module) {
    main().catch((err) => {
        console.error('[Migration] Fatal:', err);
        process.exit(1);
    });
}
