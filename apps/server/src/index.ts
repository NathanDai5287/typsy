import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getDb } from './db/client.js';
import { getCurrentDataMode } from './db/dataMode.js';
import { authMiddleware } from './auth.js';
import userRouter from './routes/user.js';
import layoutsRouter from './routes/layouts.js';
import sessionsRouter from './routes/sessions.js';
import ngramsRouter from './routes/ngrams.js';

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

// CORS: in single-origin mode (Express serves both /api and the SPA) the
// browser never makes a cross-origin request, so this only matters for
// `pnpm dev` (vite on 5173 → server on 3001) and for split-deploy setups
// where the frontend lives on a different host (e.g. Vercel).
//
// Local dev origin is always allowed. Add a comma-separated list of extra
// origins via ALLOWED_ORIGIN in the server env to allow deployed frontends.
const allowedOrigins = new Set<string>([
  'http://localhost:5173',
  ...(process.env.ALLOWED_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
]);
app.use(
  cors({
    origin: (origin, cb) => {
      // No origin → same-origin / curl / server-to-server: allow.
      if (!origin) return cb(null, true);
      if (allowedOrigins.has(origin)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json());

// Initialize DB (runs migrations + seed) on startup.
getDb();

// Public probe — useful for uptime checks and debugging cloudflared without
// needing a valid Firebase token.
app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Everything below requires a valid Firebase ID token (or BYPASS_AUTH=1
// in dev). The middleware also sets req.userId.
app.use('/api', authMiddleware);
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
const bypass = process.env.BYPASS_AUTH === '1';
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} [data mode: ${mode}]`);
  if (bypass) {
    console.log('  → BYPASS_AUTH=1: Firebase token verification disabled.');
  }
  if (mode === 'synthetic') {
    console.log('  → reading/writing the SYNTHETIC user (id=2). Real data is untouched.');
  }
});
