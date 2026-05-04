import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo } from 'react';
import {
  KeymapProvider,
  useKeymapRegistry,
  useRegisterPageKeymap,
} from './keymapContext.tsx';
import type { Keybinding } from './keymap.ts';

afterEach(() => {
  cleanup();
});

function makeQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

interface PageProps {
  onEsc: () => void;
}

function PageWithEsc({ onEsc }: PageProps): JSX.Element {
  const bindings = useMemo<Keybinding[]>(
    () => [
      {
        id: 'test.esc',
        code: 'Escape',
        description: 'page-level escape handler',
        handler: onEsc,
      },
    ],
    [onEsc],
  );
  useRegisterPageKeymap('Test', bindings);
  return <div>page-with-esc</div>;
}

function OtherPage(): JSX.Element {
  return <div>other-page</div>;
}

describe('KeymapProvider', () => {
  it('lets a page-level Escape binding fire on the very first mount', () => {
    const onEsc = vi.fn();
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <KeymapProvider>
            <Routes>
              <Route path="/" element={<PageWithEsc onEsc={onEsc} />} />
              <Route path="/other" element={<OtherPage />} />
            </Routes>
          </KeymapProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.keyDown(document, { code: 'Escape' });
    expect(onEsc).toHaveBeenCalledTimes(1);
  });

  it('still routes Escape to the page handler after navigating away and back', async () => {
    // Regression test: a page's bubble-phase Esc listener must keep
    // beating the provider's global Esc → enter-navbar binding even
    // after the page has unmounted and remounted.
    const onEsc = vi.fn();

    function Switcher(): JSX.Element {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          data-testid="go-other"
          onClick={() => navigate('/other')}
        >
          go-other
        </button>
      );
    }

    function ComeBack(): JSX.Element {
      const navigate = useNavigate();
      return (
        <button
          type="button"
          data-testid="go-back"
          onClick={() => navigate('/')}
        >
          go-back
        </button>
      );
    }

    const { getByTestId } = render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <KeymapProvider>
            <Switcher />
            <Routes>
              <Route path="/" element={<PageWithEsc onEsc={onEsc} />} />
              <Route
                path="/other"
                element={
                  <>
                    <OtherPage />
                    <ComeBack />
                  </>
                }
              />
            </Routes>
          </KeymapProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    act(() => {
      getByTestId('go-other').click();
    });
    act(() => {
      getByTestId('go-back').click();
    });

    fireEvent.keyDown(document, { code: 'Escape' });
    expect(onEsc).toHaveBeenCalledTimes(1);
  });

  it('Esc on a page without a page-level Esc binding lifts focus to the navbar', () => {
    let layer = 'content';
    function Probe(): JSX.Element {
      const k = useKeymapRegistry();
      layer = k.layer;
      return <div>probe</div>;
    }

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <KeymapProvider>
            <div data-navbar-layer-root>nav</div>
            <Probe />
          </KeymapProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(layer).toBe('content');
    act(() => {
      fireEvent.keyDown(document, { code: 'Escape' });
    });
    expect(layer).toBe('navbar');
  });

  it('lets a page claim first Esc before a second Esc lifts focus to the navbar', () => {
    let layer = 'content';
    let sessionStarted = true;
    const onEnd = vi.fn(() => {
      sessionStarted = false;
    });
    const onIdleEsc = vi.fn();

    function PracticeLikePage(): JSX.Element {
      const { layer: currentLayer, registerNavbarEscapeGuard } = useKeymapRegistry();
      layer = currentLayer;
      useEffect(() => {
        registerNavbarEscapeGuard(() => !sessionStarted);
        return () => registerNavbarEscapeGuard(null);
      }, [registerNavbarEscapeGuard]);

      const bindings = useMemo<Keybinding[]>(
        () => [
          {
            id: 'test.practice-end',
            code: 'Escape',
            description: 'end active session',
            handler: () => {
              if (sessionStarted) {
                onEnd();
                return;
              }
              onIdleEsc();
            },
          },
        ],
        [],
      );
      useRegisterPageKeymap('Test', bindings);
      return <div>practice-like-page</div>;
    }

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <KeymapProvider>
            <div data-navbar-layer-root>nav</div>
            <PracticeLikePage />
          </KeymapProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(layer).toBe('content');
    act(() => {
      fireEvent.keyDown(document, { code: 'Escape' });
    });
    expect(layer).toBe('content');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onIdleEsc).not.toHaveBeenCalled();

    act(() => {
      fireEvent.keyDown(document, { code: 'Escape' });
    });
    expect(layer).toBe('navbar');
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onIdleEsc).toHaveBeenCalledTimes(1);
  });

  it('Esc is a no-op when no navbar is mounted (e.g. /onboarding)', () => {
    let layer = 'content';
    function Probe(): JSX.Element {
      const k = useKeymapRegistry();
      layer = k.layer;
      return <div>probe</div>;
    }

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <KeymapProvider>
            <Probe />
          </KeymapProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    act(() => {
      fireEvent.keyDown(document, { code: 'Escape' });
    });
    expect(layer).toBe('content');
  });

  it('arrow keys walk between tabs in the navbar layer and Enter returns to content', () => {
    let pathname = '/';
    let layer = 'content';
    function Probe(): JSX.Element {
      const k = useKeymapRegistry();
      const loc = useLocation();
      layer = k.layer;
      pathname = loc.pathname;
      return <div>probe</div>;
    }

    render(
      <QueryClientProvider client={makeQueryClient()}>
        <MemoryRouter initialEntries={['/']}>
          <KeymapProvider>
            <div data-navbar-layer-root>nav</div>
            <Routes>
              <Route path="/" element={<Probe />} />
              <Route path="/dashboard" element={<Probe />} />
              <Route path="/layouts" element={<Probe />} />
              <Route path="/fingering" element={<Probe />} />
              <Route path="/optimize" element={<Probe />} />
              <Route path="/settings" element={<Probe />} />
            </Routes>
          </KeymapProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    // Lift into navbar layer.
    act(() => {
      fireEvent.keyDown(document, { code: 'Escape' });
    });
    expect(layer).toBe('navbar');

    // Right walks to /dashboard (next after /).
    act(() => {
      fireEvent.keyDown(document, { code: 'ArrowRight' });
    });
    expect(pathname).toBe('/dashboard');

    // Right again → /layouts.
    act(() => {
      fireEvent.keyDown(document, { code: 'ArrowRight' });
    });
    expect(pathname).toBe('/layouts');

    // Left → /dashboard.
    act(() => {
      fireEvent.keyDown(document, { code: 'ArrowLeft' });
    });
    expect(pathname).toBe('/dashboard');

    // Enter drops back to content.
    act(() => {
      fireEvent.keyDown(document, { code: 'Enter' });
    });
    expect(layer).toBe('content');
  });
});
