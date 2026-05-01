import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchUser } from './lib/api.ts';
import { useAuth } from './lib/auth.tsx';
import Nav from './components/Nav.tsx';
import StatusBar from './components/StatusBar.tsx';
import HelpOverlay from './components/HelpOverlay.tsx';
import NavbarFocusOverlay from './components/NavbarFocusOverlay.tsx';
import { KeymapProvider, useKeymapRegistry } from './lib/keymapContext.tsx';
import OnboardingPage from './pages/OnboardingPage.tsx';
import PracticePage from './pages/PracticePage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import OptimizePage from './pages/OptimizePage.tsx';
import LayoutsPage from './pages/LayoutsPage.tsx';
import FingeringPage from './pages/FingeringPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';
import LoginPage from './pages/LoginPage.tsx';

/**
 * Top-level shell.
 *
 * Layout is a single column: nav (top, sticky), main (scrollable), status
 * bar (bottom). The keymap provider wraps everything so any descendant
 * can register page-level shortcuts and they show up in the help overlay.
 *
 * Auth gate: `signedIn` is true when bypassed, when Firebase has
 * confirmed a user, or optimistically when localStorage holds a
 * cached-session hint. The optimistic case lets returning users skip the
 * "signing in…" splash on reload while Firebase rehydrates. If signed
 * out we render LoginPage instead. Only once signed in do we issue the
 * /api/user fetch.
 */
export default function App(): JSX.Element {
  const { signedIn } = useAuth();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['user'],
    queryFn: fetchUser,
    enabled: signedIn,
  });

  if (!signedIn) {
    return <LoginPage />;
  }

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-fg3 font-mono">
        loading…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-screen items-center justify-center text-red-400 font-mono px-4 text-center">
        Could not connect to the server. Make sure the backend is running on port 3001.
      </div>
    );
  }

  const needsOnboarding = !data || data.layout_progress.length === 0;

  return (
    <KeymapProvider>
      <Shell needsOnboarding={needsOnboarding} />
    </KeymapProvider>
  );
}

/**
 * Inner shell — sits inside `KeymapProvider` so it can read the active
 * focus layer. When the navbar layer is active the entire <main> is
 * blurred + dimmed + click-deactivated, and a centered "Press Enter to
 * focus" affordance sits on top.
 */
function Shell({ needsOnboarding }: { needsOnboarding: boolean }): JSX.Element {
  const { layer } = useKeymapRegistry();
  const navbarActive = !needsOnboarding && layer === 'navbar';

  return (
    <div className="min-h-screen flex flex-col bg-bg_h text-fg1 font-mono">
      {!needsOnboarding && <Nav />}
      <main
        className={[
          'flex-1 pb-7 transition-[filter,opacity] duration-150',
          navbarActive ? 'blur-sm opacity-40 pointer-events-none select-none' : '',
        ].join(' ')}
        aria-hidden={navbarActive ? 'true' : undefined}
      >
        <Routes>
          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route
            path="/"
            element={
              needsOnboarding ? (
                <Navigate to="/onboarding" replace />
              ) : (
                <PracticePage />
              )
            }
          />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/optimize" element={<OptimizePage />} />
          <Route path="/layouts" element={<LayoutsPage />} />
          <Route path="/fingering" element={<FingeringPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Routes>
      </main>
      {!needsOnboarding && <StatusBar />}
      <HelpOverlay />
      {navbarActive && <NavbarFocusOverlay />}
    </div>
  );
}
