/**
 * Firebase web SDK initialization.
 *
 * Config is read from Vite env vars (`VITE_FIREBASE_*`). These values are
 * embedded into the client bundle at build time and are technically public
 * — they identify which Firebase project to talk to, but security is
 * enforced server-side by Admin SDK token verification, not by hiding
 * these strings.
 *
 * If any required value is missing, we throw on first access so a
 * misconfigured deploy fails loudly instead of silently signing nobody in.
 */
import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth, GoogleAuthProvider } from 'firebase/auth';

interface FirebaseEnvConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  appId: string;
}

function readConfig(): FirebaseEnvConfig {
  const env = import.meta.env;
  const apiKey = env.VITE_FIREBASE_API_KEY ?? '';
  const authDomain = env.VITE_FIREBASE_AUTH_DOMAIN ?? '';
  const projectId = env.VITE_FIREBASE_PROJECT_ID ?? '';
  const appId = env.VITE_FIREBASE_APP_ID ?? '';
  const missing: string[] = [];
  if (!apiKey) missing.push('VITE_FIREBASE_API_KEY');
  if (!authDomain) missing.push('VITE_FIREBASE_AUTH_DOMAIN');
  if (!projectId) missing.push('VITE_FIREBASE_PROJECT_ID');
  if (!appId) missing.push('VITE_FIREBASE_APP_ID');
  if (missing.length > 0) {
    throw new Error(
      `Firebase config missing: ${missing.join(', ')}. ` +
        'Copy apps/web/.env.example to apps/web/.env.local and fill in the values.',
    );
  }
  return { apiKey, authDomain, projectId, appId };
}

let _app: FirebaseApp | null = null;
let _auth: Auth | null = null;

export function getFirebaseAuth(): Auth {
  if (_auth) return _auth;
  if (!_app) _app = initializeApp(readConfig());
  _auth = getAuth(_app);
  return _auth;
}

export const googleProvider = new GoogleAuthProvider();
