const { db } = require('./core/firebase.cjs');

async function main() {
  console.log('=== accounts/ ===');
  const snap = await db.collection('accounts').get();
  snap.docs.forEach(d => console.log(d.id, JSON.stringify(d.data())));

  console.log('\n=== accounts/{id}/companies/ ===');
  for (const d of snap.docs) {
    const companies = await db.collection(`accounts/${d.id}/companies`).get();
    companies.docs.forEach(c => {
      const data = c.data();
      console.log(`  accounts/${d.id}/companies/${c.id}: name=${data.name} regCode=${data.regCode} vatNumber=${data.vatNumber}`);
    });
  }

  console.log('\n=== invoices: accountId distribution ===');
  const inv = await db.collection('invoices').get();
  const dist = {};
  inv.docs.forEach(d => {
    const aid = d.data().accountId || 'NONE';
    dist[aid] = (dist[aid] || 0) + 1;
  });
  console.log(dist);

  console.log('\n=== invoices sample per accountId (first 3 each) ===');
  const byAccount = {};
  inv.docs.forEach(d => {
    const aid = d.data().accountId || 'NONE';
    if (!byAccount[aid]) byAccount[aid] = [];
    if (byAccount[aid].length < 5) byAccount[aid].push({
      id: d.id,
      vendorName: d.data().vendorName,
      companyId: d.data().companyId,
      status: d.data().status
    });
  });
  console.log(JSON.stringify(byAccount, null, 2));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
