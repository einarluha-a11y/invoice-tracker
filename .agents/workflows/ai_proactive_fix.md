---
description: How to correctly handle bug fixes, extraction errors, or missing data updates
---
When the user reports a bug, an extraction failure, or missing data in the Live Database, you MUST follow this proactive protocol:

1. **Investigate & Fix the Root Cause**: Update the AI extraction prompts (e.g., `document_ai_service.cjs`), system logic, or backend code to permanently resolve the issue for all future executions.
2. **Proactively Retrofit the Live DB**: Do not wait for the user. Write a temporary script to recover the missing or broken file. **CRITICAL SYSTEM RULE: DO NOT RUSH AND WRITE METADATA TO FIRESTORE MANUALLY (e.g. \`docRef.update({ amount: 800 })\`). This causes human errors (like missing Due Dates). You MUST ALWAYS pass the recovered file natively through the automated pipeline (e.g. \`processInvoiceWithDocAI\` and \`auditAndProcessInvoice\`) to verify the entire system physically works end-to-end and captures all metadata perfectly.**
3. **Clean Up Scaffolding**: Once the live database is successfully patched, IMMEDIATELY delete all temporary/test scripts so the repository remains completely clean and audited.
4. **Deploy the Fix**: Automatically run `git add`, `git commit` with an appropriate message (e.g., `fix(ai): ...`), and `git push origin main` so the remote repository holds the finalized truth.
5. **Report to User**: Inform the user that the UI should reflect the new data immediately upon refreshing, and explicitly state that the update was pushed to GitHub.
