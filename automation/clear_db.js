const admin = require('firebase-admin');
const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();

async function clearDatabase() {
    console.log("🔥 Начинаем полное удаление всех инвойсов из базы данных...");

    // Получаем все документы в коллекции invoices
    const invoicesRef = db.collection('invoices');
    const snapshot = await invoicesRef.get();

    if (snapshot.empty) {
        console.log("База данных уже пуста!");
        process.exit(0);
    }

    // Удаляем батчем
    const batch = db.batch();
    snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
    });

    await batch.commit();
    console.log(`✅ Успешно удален(о) ${snapshot.size} документ(ов).`);
    console.log("База данных полностью очищена и готова к загрузке новых чистых данных!");
    process.exit(0);
}

clearDatabase().catch(console.error);
