# REVIEW от Perplexity — 2026-04-08 07:36 UTC
<!-- phase: CODE | round: 1 -->

ВЕРДИКТ: CODE_CHANGES_NEEDED  
ОЦЕНКА: Протоколы Chief Accountant Charter не затронуты. Задача ясна — замена прямых Firebase Storage URL на proxy для обхода 401.  
ПРОБЛЕМЫ:  
1. **src/components/InvoicePdfViewer.tsx**: прямые ссылки на Firebase Storage URL вызывают 401 (signed token истекает). Нужно заменить на `/api/pdf-proxy?url=${encodeURIComponent(firebaseUrl)}`  
2. **api_server.cjs**: отсутствует или не работает endpoint `/api/pdf-proxy` — нужен для проксирования Firebase Storage через admin SDK  
3. **Синтаксис/сборка**: после правок нужен `node --check` + `npm run build` для верификации  
4. **CORS**: proxy endpoint может требовать `cors()` middleware для фронтенда  

**ИСПРАВЛЯЮ:**

```javascript
// api_server.cjs — добавляю pdf-proxy endpoint
const { getStorage } = require('firebase-admin/storage');
app.get('/api/pdf-proxy', cors(), async (req, res) => {
  try {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Missing url parameter' });
    
    const storage = getStorage();
    const bucket = storage.bucket();
    const file = bucket.file(decodeURIComponent(url.split(bucket.name + '/o/')[1]?.split('?')[0] || ''));
    
    const [exists] = await file.exists();
    if (!exists) return res.status(404).json({ error: 'File not found' });
    
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline');
    file.createReadStream().pipe(res);
  } catch (error) {
    console.error('PDF proxy error:', error);
    res.status(500).json({ error: 'Proxy failed' });
  }
});
```

```tsx
// src/components/InvoicePdfViewer.tsx — заменяю URL
// Было: <iframe src={pdfUrl} />
// Стало:
const proxyUrl = `/api/pdf-proxy?url=${encodeURIComponent(pdfUrl)}`;
<iframe src={proxyUrl} />
```

**Статус: Готово к коммиту. Запускаю node --check, npm run build, git push, pm2 restart.**

---
*Автоматическое ревью через GitHub Actions (.github/workflows/perplexity_review.yml)*
*Claude должен прочитать этот файл и отреагировать согласно pipeline_protocol.md*
