import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useNavigate } from 'react-router-dom';
import { useMemo } from 'react';
import { KeymapProvider, useRegisterPageKeymap } from './keymapContext.tsx';
import type { Keybinding } from './keymap.ts';

afterEach(() => {
  cleanup();
});

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
      <MemoryRouter initialEntries={['/']}>
        <KeymapProvider>
          <Routes>
            <Route path="/" element={<PageWithEsc onEsc={onEsc} />} />
            <Route path="/other" element={<OtherPage />} />
          </Routes>
        </KeymapProvider>
      </MemoryRouter>,
    );

    fireEvent.keyDown(document, { code: 'Escape' });
    expect(onEsc).toHaveBeenCalledTimes(1);
  });

  it('still routes Escape to the page handler after navigating away and back', async () => {
    // Regression test: the global keymap used to register an `Escape →
    // closeHelp` binding. After remounting the page (e.g. nav away → nav
    // back), the page's bubble-phase Esc listener landed *behind* the
    // already-installed global one in the document's listener queue, so
    // the global handler fired first, called `stopImmediatePropagation`,
    // and the page's "end session" / "clear selection" handler never
    // ran. The fix removes the redundant global Esc binding (the help
    // overlay still closes on Esc via a capture-phase effect that's only
    // wired up while it's open).
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
      </MemoryRouter>,
    );

    // Navigate away (PracticePage equivalent unmounts).
    act(() => {
      getByTestId('go-other').click();
    });
    // Navigate back (page remounts; its useKeymap listener is now
    // registered AFTER the long-lived global listener).
    act(() => {
      getByTestId('go-back').click();
    });

    fireEvent.keyDown(document, { code: 'Escape' });
    expect(onEsc).toHaveBeenCalledTimes(1);
  });

  it('does not consume Escape when the help overlay is closed', () => {
    // A bystander listener registered AFTER the provider should still
    // see Esc events. Before the fix, the global `closeHelp` binding
    // called stopImmediatePropagation on every Esc regardless of overlay
    // state, suppressing every other Esc handler in the app.
    const bystander = vi.fn();
    document.addEventListener('keydown', bystander);
    try {
      render(
        <MemoryRouter initialEntries={['/']}>
          <KeymapProvider>
            <Routes>
              <Route path="/" element={<OtherPage />} />
            </Routes>
          </KeymapProvider>
        </MemoryRouter>,
      );

      fireEvent.keyDown(document, { code: 'Escape' });
      expect(bystander).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', bystander);
    }
  });
});
