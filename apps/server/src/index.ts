import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb } from './db/client.js';
import { getCurrentDataMode } from './db/dataMode.js';
import userRouter from './routes/user.js';
import layoutsRouter from './routes/layouts.js';
import sessionsRouter from './routes/sessions.js';
import ngramsRouter from './routes/ngrams.js';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors({ origin: 'http://localhost:5173' }));
app.use(express.json());

// Initialize DB (runs migrations + seed) on startup.
getDb();

app.use('/api/user', userRouter);
app.use('/api/layouts', layoutsRouter);
app.use('/api/sessions', sessionsRouter);
app.use('/api/ngrams', ngramsRouter);

// In production (single-origin deploy), serve the built SPA from the same Express
// process so /api and the web app share a hostname. Resolved from this file's
// location: apps/server/dist/index.js → ../../web/dist. Guarded by fs.existsSync
// so dev mode (where apps/web/dist may not exist) is unaffected.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(__dirname, '../../web/dist');
if (fs.existsSync(webDistDir)) {
  app.use(express.static(webDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.sendFile(path.join(webDistDir, 'index.html'));
  });
}

const mode = getCurrentDataMode();
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} [data mode: ${mode}]`);
  if (mode === 'synthetic') {
    console.log('  → reading/writing the SYNTHETIC user (id=2). Real data is untouched.');
  }
});
