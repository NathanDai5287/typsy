import express from 'express';
import cors from 'cors';
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

const mode = getCurrentDataMode();
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT} [data mode: ${mode}]`);
  if (mode === 'synthetic') {
    console.log('  → reading/writing the SYNTHETIC user (id=2). Real data is untouched.');
  }
});
