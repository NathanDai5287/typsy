import { Routes, Route, Navigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchUser } from './lib/api.ts';
import Nav from './components/Nav.tsx';
import OnboardingPage from './pages/OnboardingPage.tsx';
import PracticePage from './pages/PracticePage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import OptimizePage from './pages/OptimizePage.tsx';
import LayoutsPage from './pages/LayoutsPage.tsx';
import FingeringPage from './pages/FingeringPage.tsx';
import SettingsPage from './pages/SettingsPage.tsx';

export default function App() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['user'],
    queryFn: fetchUser,
  });

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-gray-400">
        Loading…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-screen items-center justify-center text-red-400">
        Could not connect to server. Make sure the backend is running on port 3001.
      </div>
    );
  }

  const needsOnboarding = !data || data.layout_progress.length === 0;

  return (
    <div className="min-h-screen flex flex-col">
      {!needsOnboarding && <Nav />}
      <main className="flex-1">
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
    </div>
  );
}
