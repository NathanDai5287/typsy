/**
 * Firebase Auth integration for the Express API.
 *
 * Flow:
 *   1. The frontend (Firebase web SDK) signs the user in with Google and
 *      acquires an ID token (a short-lived JWT).
 *   2. Every request to /api/* arrives with `Authorization: Bearer <token>`.
 *   3. `authMiddleware` verifies that token via firebase-admin and resolves
 *      it to a row in the `users` table, attaching `req.userId` for
 *      downstream route handlers.
 *
 * Linking the existing prod data:
 *   The pre-auth DB has a single real user at `id=1`. Setting
 *   `TYPSY_OWNER_FIREBASE_UID=<your_uid>` in the server env tells this
 *   module that the very first time that UID signs in, it should be
 *   stamped onto user_id=1 instead of creating a new row. That way every
 *   session, ngram, and progress row already attached to user_id=1 stays
 *   yours forever, no data migration needed.
 *
 * Dev escape hatch:
 *   `BYPASS_AUTH=1` in the env disables verification and falls back to
 *   the legacy `getCurrentUserId()` switcher (real vs synthetic). This
 *   keeps `pnpm dev` and `pnpm dev:synth` working without forcing every
 *   developer to set up a Firebase project just to iterate locally.
 */
import type { Request, Response, NextFunction, RequestHandler } from 'express';
import admin from 'firebase-admin';
import { getDb } from './db/client.js';
import { getCurrentDataMode, getCurrentUserId, REAL_USER_ID } from './db/dataMode.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** App-level user_id resolved from the verified Firebase token (or the
       *  bypass shortcut). Always set inside `/api/*` handlers — the
       *  middleware short-circuits with 401 if it can't resolve one. */
      userId?: number;
      /** Verified Firebase UID, when auth is not bypassed. */
      firebaseUid?: string;
    }
  }
}

let initialized = false;

/**
 * Lazy-init the Admin SDK from env. Called once on first authed request so
 * the server can boot without Firebase creds in dev (BYPASS_AUTH=1).
 *
 * Two ways to provide credentials, in priority order:
 *   1. GOOGLE_APPLICATION_CREDENTIALS=/abs/path/to/service-account.json
 *      (the canonical Google-cloud env var; admin SDK reads it natively).
 *   2. FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
 *      (paste the three fields from a downloaded service-account JSON).
 *
 * The private key in the env-var form has its newlines escaped as `\n`;
 * we un-escape so the PEM parser is happy.
 */
function initAdmin(): void {
  if (initialized) return;
  if (admin.apps.length > 0) {
    initialized = true;
    return;
  }

  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    initialized = true;
    return;
  }

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      'Firebase Admin not configured. Set FIREBASE_PROJECT_ID, ' +
        'FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY (or ' +
        'GOOGLE_APPLICATION_CREDENTIALS) in the server env. ' +
        'For local dev without Firebase, set BYPASS_AUTH=1.',
    );
  }
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey: privateKey.replace(/\\n/g, '\n'),
    }),
  });
  initialized = true;
}

function isAuthBypassed(): boolean {
  return process.env.BYPASS_AUTH === '1';
}

/**
 * Resolve a Firebase UID to an app `users.id`. If the UID is the configured
 * owner UID and the existing real-user row is unclaimed, stamp the UID on
 * row 1 (preserving every session/ngram already attached to it). Otherwise
 * create a fresh user row.
 */
function resolveUserId(firebaseUid: string): number {
  const db = getDb();
  const existing = db
    .prepare('SELECT id FROM users WHERE firebase_uid = ?')
    .get(firebaseUid) as { id: number } | undefined;
  if (existing) return existing.id;

  const ownerUid = process.env.TYPSY_OWNER_FIREBASE_UID;
  if (ownerUid && firebaseUid === ownerUid) {
    // Atomic: only stamp the real-user row if nobody else has claimed it yet.
    const result = db
      .prepare(
        'UPDATE users SET firebase_uid = ? WHERE id = ? AND firebase_uid IS NULL',
      )
      .run(firebaseUid, REAL_USER_ID);
    if (result.changes === 1) return REAL_USER_ID;
    // The owner row is already linked to a different UID — fall through and
    // create a new user row so we don't silently hijack someone else's data.
  }

  const insert = db
    .prepare('INSERT INTO users (firebase_uid) VALUES (?)')
    .run(firebaseUid);
  return insert.lastInsertRowid as number;
}

/**
 * Express middleware. Attach to /api/* (with public exemptions like /api/health
 * mounted before this).
 */
export const authMiddleware: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (isAuthBypassed()) {
    req.userId = getCurrentUserId();
    next();
    return;
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing Authorization: Bearer <token>' });
    return;
  }
  const token = header.slice('Bearer '.length).trim();
  if (!token) {
    res.status(401).json({ error: 'Empty bearer token' });
    return;
  }

  try {
    initAdmin();
    const decoded = await admin.auth().verifyIdToken(token);
    req.firebaseUid = decoded.uid;
    // Dev override: when the server is started in synthetic mode, every
    // authed request reads/writes the synthetic user regardless of which
    // Firebase account signed in. Lets you flip between real/synthetic
    // data without signing out.
    req.userId = getCurrentDataMode() === 'synthetic'
      ? getCurrentUserId()
      : resolveUserId(decoded.uid);
    next();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    res.status(401).json({ error: `Invalid token: ${msg}` });
  }
};

/** Helper for handlers: throw a 401-as-string if userId isn't resolved. */
export function requireUserId(req: Request): number {
  if (req.userId === undefined) {
    throw new Error('No userId on request — authMiddleware not mounted?');
  }
  return req.userId;
}
