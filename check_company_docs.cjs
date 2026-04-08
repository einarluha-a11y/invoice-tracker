require("dotenv").config({ path: ".env.production" });
const { db } = require("./automation/core/firebase.cjs");

(async () => {
  const accs = await db.collection("accounts").get();
  for (const acc of accs.docs) {
    console.log(`\n=== account: ${acc.id} ===`);
    console.log("Account data:", JSON.stringify(acc.data()));
    const cos = await acc.ref.collection("companies").get();
    for (const co of cos.docs) {
      console.log(`  doc.id: ${co.id}`);
      console.log(`  doc.data: ${JSON.stringify(co.data())}`);
    }
  }
  process.exit(0);
})();
