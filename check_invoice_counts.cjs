require("dotenv").config({ path: ".env.production" });
const { db } = require("./automation/core/firebase.cjs");

(async () => {
  const cos = await db.collection("companies").get();
  for (const co of cos.docs) {
    const all = await db.collection("invoices").where("companyId","==",co.id).get();
    const archived = all.docs.filter(d => d.data().archived === true).length;
    console.log(`${co.data().name} (${co.id}): ${all.size} total, ${archived} archived, ${all.size - archived} active`);
  }
  // Check invoices without companyId
  const noCompany = await db.collection("invoices").where("companyId","==",null).get();
  console.log(`\nInvoices with null companyId: ${noCompany.size}`);
  process.exit(0);
})();
