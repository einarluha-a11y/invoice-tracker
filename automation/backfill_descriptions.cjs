const admin = require('firebase-admin');
const { OpenAI } = require('openai');
require('dotenv').config();

const serviceAccount = require('./google-credentials.json');

if (!admin.apps.length) {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
}
const db = admin.firestore();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });


const delay = (ms) => new Promise(res => setTimeout(res, ms));

async function runBackfill() {
    console.log('Fetching all invoices from Firestore...');
    const snapshot = await db.collection('invoices').get();

    if (snapshot.empty) {
        console.log('No invoices found.');
        return;
    }

    const invoices = [];
    snapshot.forEach(doc => {
        const data = doc.data();
        // Update ALL invoices to ensure they have the new format with the Invoice ID
        invoices.push({ id: doc.id, ...data });
    });

    console.log(`Found ${invoices.length} invoices without a description. Starting AI backfill...`);

    // We'll process them in small batches to not hit OpenAI rate limits
    for (let i = 0; i < invoices.length; i++) {
        const inv = invoices[i];
        console.log(`[${i + 1}/${invoices.length}] Processing vendor: ${inv.vendorName} (${inv.amount} ${inv.currency})`);

        const prompt = `
     You are a bookkeeper. I have an invoice from a vendor but I lost the description of what the invoice was for.
     Can you guess a very short 2-4 word description of what was likely purchased based on the Vendor Name and the Amount?
     Return ONLY the description text, no extra words, no quotes, no markdown. Answer in Russian.
     
     IMPORTANT: You MUST append the Invoice ID to the end of your description in the format "Описание - [Invoice ID]".
     
     Vendor Name: ${inv.vendorName}
     Amount: ${inv.amount} ${inv.currency || 'EUR'}
     Invoice ID: ${inv.id}
     
     If you really cannot guess, return "Оплата по счету - ${inv.id}".
     If it's Bolt, return "Такси / Транспорт - ${inv.id}".
     If it's Google, return "Облачные сервисы - ${inv.id}".
     If it's Alexela, return "Топливо - ${inv.id}".
     If it's Hydroscand, return "Детали оборудования - ${inv.id}".
     `;

        try {
            const response = await openai.chat.completions.create({
                model: "gpt-4o-mini", // Use mini for speed and cheap cost
                messages: [{ role: "user", content: prompt }],
                temperature: 0.1,
            });

            let description = response.choices[0].message.content.trim();
            // Remove pesky quotes if it added them anyway
            description = description.replace(/^["']|["']$/g, '');

            // Update firestore
            await db.collection('invoices').doc(inv.id).update({
                description: description
            });

            console.log(`  -> Assigned description: "${description}"\n`);

            // sleep 1s between requests to be safe
            await delay(1000);

        } catch (err) {
            console.error(`  -> ERROR on ${inv.id}:`, err);
            // delay a bit longer on error
            await delay(5000);
        }
    }

    console.log('🎉 Done backfilling all historical invoices!');
    process.exit(0);
}

runBackfill();
