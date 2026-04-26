/**
 * AuthContext — exposes the current Firebase user, sign-in/out actions, and
 * a `getIdToken()` helper that the api.ts request layer uses to attach
 * `Authorization: Bearer <token>` to every server call.
 *
 * The provider subscribes to `onAuthStateChanged` so the UI re-renders
 * immediately when the user signs in or the SDK refreshes the token.
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
  /** null while loading, false after we've confirmed nobody is signed in. */
  user: FirebaseUser | null;
  loading: boolean;
  bypassed: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  /** Always returns a fresh-enough token, or null if not signed in or bypassed. */
  getIdToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const BYPASS = import.meta.env.VITE_BYPASS_AUTH === '1';

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [loading, setLoading] = useState<boolean>(!BYPASS);

  useEffect(() => {
    // Expose the SDK's currentUser.getIdToken() to the non-React api.ts
    // module so every fetch can pull a fresh token without prop-drilling.
    setTokenGetter(async () => {
      if (BYPASS) return null;
      const auth = getFirebaseAuth();
      const u = auth.currentUser;
      if (!u) return null;
      return u.getIdToken();
    });

    if (BYPASS) return;
    const auth = getFirebaseAuth();
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
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
        const u = auth.currentUser;
        if (!u) return null;
        return u.getIdToken();
      },
    }),
    [user, loading],
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
