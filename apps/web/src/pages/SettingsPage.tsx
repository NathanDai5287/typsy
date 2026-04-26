import { useState } from 'react';
import { useAuth } from '../lib/auth.tsx';

/**
 * Settings page is intentionally minimal — most preferences (input mode,
 * appearance, finger fade) belong on their own dedicated pages or live
 * implicitly in the data model. This page exists as a forward slot, plus
 * the one place where the signed-in account is exposed and can be cleared.
 */
export default function SettingsPage(): JSX.Element {
  const { user, signOut, bypassed } = useAuth();
  const [busy, setBusy] = useState<boolean>(false);

  async function handleSignOut(): Promise<void> {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl text-fg_h">settings</h1>
        <p className="text-fg3 text-sm mt-1">
          Preferences live here. Currently nothing to configure — typing
          mode, fingering, and layouts each have their own dedicated page.
        </p>
      </header>

      <section className="panel p-4 space-y-3 text-sm mb-4">
        <h2 className="panel-heading">Account</h2>
        {bypassed ? (
          <div className="text-fg3">
            Auth is bypassed in this dev environment (BYPASS_AUTH=1).
          </div>
        ) : user ? (
          <div className="space-y-2">
            <div className="text-fg2">
              Signed in as{' '}
              <span className="text-fg_h">{user.email ?? user.uid}</span>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              disabled={busy}
              className="panel px-3 py-1 text-fg2 hover:border-yellow-400 disabled:opacity-50"
            >
              {busy ? 'signing out…' : 'sign out'}
            </button>
          </div>
        ) : (
          <div className="text-fg3">Not signed in.</div>
        )}
      </section>

      <section className="panel p-4 space-y-3 text-sm">
        <h2 className="panel-heading">Coming up</h2>
        <ul className="space-y-1 text-fg2">
          <li>• Adjustable muscle-memory fade strength</li>
          <li>• Light / dark / amber-on-black themes</li>
          <li>• Keymap remapping</li>
          <li>• Synthetic data toggle (currently env-only)</li>
        </ul>
      </section>
    </div>
  );
}
