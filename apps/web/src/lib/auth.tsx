/**
 * AuthContext — exposes the current Firebase user, sign-in/out actions, and
 * a `getIdToken()` helper that the api.ts request layer uses to attach
 * `Authorization: Bearer <token>` to every server call.
 *
 * The provider subscribes to `onAuthStateChanged` so the UI re-renders
 * immediately when the user signs in or the SDK refreshes the token.
 *
 * On boot, we read a localStorage hint (`typsy:was-signed-in`) synchronously
 * and optimistically treat the user as signed in if it's set. That lets the
 * app shell render immediately on reload instead of flashing a "signing in…"
 * splash while Firebase rehydrates its persisted session (which can stretch
 * to ~500ms when a near-expiry ID token gets refreshed). The hint is updated
 * whenever onAuthStateChanged fires, so a sign-out elsewhere clears it for
 * the next reload.
 *
 * `BYPASS_AUTH` mode (mirror of the server flag): if
 * `VITE_BYPASS_AUTH=1`, this provider skips Firebase entirely and
 * pretends the user is signed in. Useful for local dev that wants to
 * iterate on UI without touching Firebase Console.
 */
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as fbSignOut,
  type User as FirebaseUser,
} from 'firebase/auth';
import { getFirebaseAuth, googleProvider } from './firebase.ts';

interface AuthContextValue {
  user: FirebaseUser | null;
  /**
   * True when bypassed, when a real user is loaded, or while we are
   * optimistically rendering based on a cached-session hint. Use this
   * to gate app-shell vs login rendering.
   */
  signedIn: boolean;
  bypassed: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Always returns a fresh-enough token, or null if not signed in or bypassed. */
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BYPASS = import.meta.env.VITE_BYPASS_AUTH === '1';

// Set to '1' in localStorage whenever onAuthStateChanged fires with a
// non-null user, removed when it fires with null. We persist our own hint
// instead of probing Firebase's internal keys because those depend on
// which persistence backend (IndexedDB vs localStorage) Firebase chose,
// which varies across SDK versions and browser modes.
const SIGNED_IN_HINT_KEY = 'typsy:was-signed-in';

function readSignedInHint(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(SIGNED_IN_HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSignedInHint(signedIn: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (signedIn) window.localStorage.setItem(SIGNED_IN_HINT_KEY, '1');
    else window.localStorage.removeItem(SIGNED_IN_HINT_KEY);
  } catch {
    // localStorage may be unavailable (private mode, blocked cookies).
    // Non-fatal — auth still works, the user just sees the splash again.
  }
}

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [optimisticSignedIn, setOptimisticSignedIn] = useState<boolean>(
    BYPASS || readSignedInHint(),
  );

  useEffect(() => {
    // Expose the SDK's currentUser.getIdToken() to the non-React api.ts
    // module so every fetch can pull a fresh token without prop-drilling.
    setTokenGetter(async () => {
      if (BYPASS) return null;
      const auth = getFirebaseAuth();
      // Wait for Firebase's persisted-session load to finish before
      // reading currentUser. Otherwise a request fired during the
      // optimistic-render window (after the hint says "signed in" but
      // before Firebase has rehydrated) goes without an Authorization
      // header and the server 401s.
      await auth.authStateReady();
      const u = auth.currentUser;
      if (!u) return null;
      return u.getIdToken();
    });

    if (BYPASS) return;
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setOptimisticSignedIn(!!u);
      writeSignedInHint(!!u);
    });
  }, []);

  const signedIn = BYPASS || !!user || optimisticSignedIn;

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      signedIn,
      bypassed: BYPASS,
      signIn: async () => {
        if (BYPASS) return;
        const auth = getFirebaseAuth();
        await signInWithPopup(auth, googleProvider);
      },
      signOut: async () => {
        if (BYPASS) return;
        const auth = getFirebaseAuth();
        await fbSignOut(auth);
      },
      getIdToken: async () => {
        if (BYPASS) return null;
        const auth = getFirebaseAuth();
        await auth.authStateReady();
        const u = auth.currentUser;
        if (!u) return null;
        return u.getIdToken();
      },
    }),
    [user, signedIn],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Singleton accessor for `getIdToken` that lib/api.ts can call without
 * touching React. Set once by AuthProvider on mount.
 */
let _tokenGetter: (() => Promise<string | null>) | null = null;

export function setTokenGetter(fn: () => Promise<string | null>): void {
  _tokenGetter = fn;
}

export async function getCurrentIdToken(): Promise<string | null> {
  if (BYPASS) return null;
  if (!_tokenGetter) return null;
  return _tokenGetter();
}
