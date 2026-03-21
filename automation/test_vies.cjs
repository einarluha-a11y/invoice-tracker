const { validateVat } = require('./vies_validator.cjs');

async function testVat(vat) {
    console.log(`Testing VAT: ${vat}`);
    const res = await validateVat(vat);
    console.log(JSON.stringify(res, null, 2));
}

testVat('IE6388047V'); // Google Ireland
