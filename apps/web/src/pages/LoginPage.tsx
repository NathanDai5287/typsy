import { useState } from 'react';
import { useAuth } from '../lib/auth.tsx';

export default function LoginPage(): JSX.Element {
  const { signIn } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<boolean>(false);

  async function handleSignIn(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await signIn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Sign-in failed';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-screen items-center justify-center bg-bg_h text-fg1 font-mono">
      <div className="panel p-8 max-w-md w-full mx-4 space-y-5">
        <div>
          <div className="text-fg_h font-semibold mb-1">typsy</div>
          <div className="text-xs text-fg3">
            keyboard layout trainer · sign in to continue
          </div>
        </div>

        <button
          type="button"
          onClick={handleSignIn}
          disabled={busy}
          className="w-full panel p-3 text-left hover:border-yellow-400 focus-visible:border-yellow-400 focus-visible:outline-none disabled:opacity-50"
        >
          <div className="flex items-center justify-between">
            <span className="text-fg_h">
              {busy ? 'opening Google popup…' : 'continue with Google'}
            </span>
            <span className="text-[10px] uppercase tracking-widest text-fg3 border border-fg3 px-1">
              [enter]
            </span>
          </div>
        </button>

        {error && (
          <div className="text-xs text-red-400 break-words">
            {error}
          </div>
        )}

        <div className="text-[11px] text-fg3 leading-relaxed">
          Your practice data, sessions, and ngram stats are tied to the Google
          account you sign in with. Signing out doesn't delete anything;
          signing back in restores it.
        </div>
      </div>
    </div>
  );
}
