---
description: How to correctly handle bug fixes, extraction errors, or missing data updates
---
When the user reports a bug, an extraction failure, or missing data in the Live Database, you MUST follow this proactive protocol:

1. **Investigate & Fix the Root Cause**: Update the AI extraction prompts (e.g., `document_ai_service.cjs`), system logic, or backend code to permanently resolve the issue for all future executions.
2. **Proactively Retrofit the Live DB**: Do not wait for the user to trigger a manual rescrape or ask you to fix the past data. Instead, write a temporary Node.js script to pull the specific affected record (e.g., searching by `invoiceId` in Firestore), re-run the file/image through your locally fixed pipeline, and `docRef.update()` the database directly with the newly extracted or missing fields.
3. **Clean Up Scaffolding**: Once the live database is successfully patched, IMMEDIATELY delete all temporary/test scripts so the repository remains completely clean and audited.
4. **Deploy the Fix**: Automatically run `git add`, `git commit` with an appropriate message (e.g., `fix(ai): ...`), and `git push origin main` so the remote repository holds the finalized truth.
5. **Report to User**: Inform the user that the UI should reflect the new data immediately upon refreshing, and explicitly state that the update was pushed to GitHub.
