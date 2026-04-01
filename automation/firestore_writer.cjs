/**
 * firestore_writer.cjs — Shared Firestore writer module
 *
 * Re-exports writeToFirestore from imap_daemon.cjs so that other scripts
 * (reprocess.cjs, etc.) can use it without starting the IMAP polling daemon.
 *
 * imap_daemon.cjs guards its startup with `require.main === module`,
 * so importing it here is safe — no polling loop starts.
 */

const { writeToFirestore } = require('./imap_daemon.cjs');

module.exports = { writeToFirestore };
