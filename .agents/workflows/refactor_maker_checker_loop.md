---
name: Refactor — Extract Shared Maker-Checker AI Loop
description: The PDF and Image processing code in index.js contains an identical Maker-Checker AI loop duplicated twice. Extract it into a shared helper function runMakerCheckerLoop() to eliminate duplication and make future changes easier.
priority: MEDIUM
triggers:
  - manual
---

// turbo-all

# TASK: Refactor Maker-Checker Loop into Shared Function

## Problem

In `automation/index.js`, there are two **identical** Maker-Checker AI loops:
1. One for **PDF attachments** (around line 980)
2. One for **image attachments** (around line 1037)

Both blocks look like this:

```js
let parsedData = null;
let extractionAttempts = 0;
let maxExtractionAttempts = 5;
let critique = null;

while (!parsedData && extractionAttempts < maxExtractionAttempts) {
    extractionAttempts++;
    const tempParsed = await processInvoiceWithDocAI(attachment.content, mime, critique, companyData.customAiRules);

    if (tempParsed && tempParsed.length > 0) {
        const supervisorVerdict = await intellectualSupervisorGate(tempParsed[0]);

        if (!supervisorVerdict.passed && supervisorVerdict.needsReExtraction) {
            // ... retry with critique
        } else if (!supervisorVerdict.passed && !supervisorVerdict.needsReExtraction) {
            // ... mark as anomaly
        } else {
            parsedData = tempParsed;
        }
    } else {
        break;
    }
}
```

## Fix

### Step 1 — Add the shared helper function to index.js

Find the `reconcilePayment` function definition. **Just above it**, insert this new function:

```js
/**
 * Runs the Maker-Checker AI extraction loop for a single document.
 * Shared by both PDF and Image processing paths.
 * @param {Buffer} content - Raw file content
 * @param {string} mimeType - MIME type (e.g. 'application/pdf', 'image/jpeg')
 * @param {Object} companyData - Company config including customAiRules
 * @param {number} maxAttempts - Max retry attempts (default 5)
 * @returns {Array|null} Parsed invoice data array, or null if extraction failed
 */
async function runMakerCheckerLoop(content, mimeType, companyData, maxAttempts = 5) {
    let parsedData = null;
    let extractionAttempts = 0;
    let critique = null;

    while (!parsedData && extractionAttempts < maxAttempts) {
        extractionAttempts++;
        const tempParsed = await processInvoiceWithDocAI(content, mimeType, critique, companyData.customAiRules);

        if (!tempParsed || tempParsed.length === 0) break;

        const supervisorVerdict = await intellectualSupervisorGate(tempParsed[0]);

        if (!supervisorVerdict.passed && supervisorVerdict.needsReExtraction) {
            console.log(`[Supervisor 🗣️ Engine] MISSING DATA! Rerunning extraction: ${supervisorVerdict.critique}`);
            critique = supervisorVerdict.critique;

            if (extractionAttempts >= maxAttempts) {
                console.log(`[Supervisor] ⚠️ Max reflection attempts reached. Accepting with missing data flag.`);
                tempParsed[0].validationWarnings = tempParsed[0].validationWarnings || [];
                tempParsed[0].validationWarnings.push(`SUPERVISOR: Forced to accept missing data after deep scan.`);
                tempParsed[0].status = 'ANOMALY_DETECTED';
                parsedData = tempParsed;
            }
        } else if (!supervisorVerdict.passed && !supervisorVerdict.needsReExtraction) {
            console.log(`[Supervisor] 🚨 ANOMALY STRIKE: ${supervisorVerdict.reason}`);
            tempParsed[0].status = 'ANOMALY_DETECTED';
            tempParsed[0].validationWarnings = tempParsed[0].validationWarnings || [];
            tempParsed[0].validationWarnings.push(`SUPERVISOR STRIKE: ${supervisorVerdict.reason}`);
            parsedData = tempParsed;
        } else {
            parsedData = tempParsed;
        }
    }

    return parsedData;
}
```

### Step 2 — Replace the PDF Maker-Checker block

Find the PDF processing block that starts with:
```js
console.log('[Email] Verified as INVOICE. Engaging Maker-Checker AI Loop...');

let parsedData = null;
let extractionAttempts = 0;
let maxExtractionAttempts = 5;
let critique = null;

while (!parsedData && extractionAttempts < maxExtractionAttempts) {
```

Replace the entire block (including the while loop through `}`) with:

```js
console.log('[Email] Verified as INVOICE. Engaging Maker-Checker AI Loop...');

const parsedData = await runMakerCheckerLoop(attachment.content, mime || 'application/pdf', companyData);
```

### Step 3 — Replace the Image Maker-Checker block

Find the image processing block that starts with:
```js
console.log('[Image] Verified. Engaging Maker-Checker AI Loop for Image...');

let parsedData = null;
let extractionAttempts = 0;
let maxExtractionAttempts = 5;
let critique = null;

while (!parsedData && extractionAttempts < maxExtractionAttempts) {
```

Replace the entire block with:

```js
console.log('[Image] Verified. Engaging Maker-Checker AI Loop for Image...');

const parsedData = await runMakerCheckerLoop(attachment.content, mime, companyData);
```

### Step 4 — Verify syntax

```bash
cd /Users/einarluha/invoice-tracker
node --check automation/index.js && echo "✅ Syntax OK" || echo "❌ Syntax Error"
```

### Step 5 — Commit

```bash
cd /Users/einarluha/invoice-tracker
git add automation/index.js
git commit -m "refactor: extract shared runMakerCheckerLoop() helper to eliminate code duplication"
```
