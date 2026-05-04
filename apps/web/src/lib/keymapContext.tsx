import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useLocation, useNavigate, matchPath } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { Keybinding } from './keymap.ts';
import { useKeymap } from './keymap.ts';
import {
  fetchLayoutSummary,
  fetchNgramStats,
  fetchSessions,
  fetchUser,
} from './api.ts';

/**
 * Global keymap registry + layered focus model.
 *
 * Two responsibilities:
 *   1. Keep a list of keybindings registered by every page so the help
 *      overlay (`?`) can render an accurate, up-to-date list.
 *   2. Run the Monkeytype-style two-layer focus state machine: pages run
 *      in the CONTENT layer by default; pressing Esc (with nothing else
 *      claiming it) lifts the user into the NAVBAR layer where Left/Right
 *      walk between the top tabs and Enter drops back to CONTENT.
 *
 * The layer is owned here so any component (Nav, StatusBar, the practice
 * typing handler) can react to it via `useKeymapRegistry()`.
 */

export interface KeymapSection {
  /** Section header in the help overlay (e.g. "Practice"). */
  title: string;
  /** Bindings to display under that header. */
  bindings: readonly Keybinding[];
}

export type FocusLayer = 'content' | 'navbar';

interface KeymapRegistry {
  /** Bindings shown under "Global". Populated by `KeymapProvider`. */
  global: Keybinding[];
  /** Bindings registered by the current page. Pages call `useRegisterPageKeymap`. */
  page: KeymapSection | null;
}

interface KeymapContextValue {
  registry: KeymapRegistry;
  registerPage: (section: KeymapSection | null) => void;
  /** Open the help overlay. */
  openHelp: () => void;
  /** Whether the help overlay is open. */
  isHelpOpen: boolean;
  /** Which interaction layer is currently active. */
  layer: FocusLayer;
  /** Lift focus to the navbar (arrow keys then walk between tabs). */
  enterNavbarLayer: () => void;
  /** Drop focus back to the page body. */
  enterContentLayer: () => void;
  /** Optional page guard for plain Esc -> navbar focus. Return false to claim Esc. */
  registerNavbarEscapeGuard: (guard: (() => boolean) | null) => void;
}

const Ctx = createContext<KeymapContextValue | null>(null);

export function useKeymapRegistry(): KeymapContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useKeymapRegistry must be inside <KeymapProvider>');
  return v;
}

/**
 * Tabs the navbar layer cycles through. Order matches the visible nav.
 * Kept in sync with `Nav.tsx`.
 */
export const NAV_TABS: readonly { to: string; end?: boolean }[] = [
  { to: '/', end: true },
  { to: '/dashboard' },
  { to: '/layouts' },
  { to: '/fingering' },
  { to: '/optimize' },
  { to: '/settings' },
];

function findTabIndex(pathname: string): number {
  for (let i = 0; i < NAV_TABS.length; i++) {
    const t = NAV_TABS[i];
    const m = matchPath({ path: t.to, end: t.end ?? false }, pathname);
    if (m) return i;
  }
  return 0;
}

interface KeymapProviderProps {
  children: React.ReactNode;
}

export function KeymapProvider({ children }: KeymapProviderProps): JSX.Element {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const queryClient = useQueryClient();
  const [pageSection, setPageSection] = useState<KeymapSection | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [layer, setLayer] = useState<FocusLayer>('content');
  const navbarEscapeGuardRef = useRef<(() => boolean) | null>(null);

  const enterNavbarLayer = useCallback(() => {
    setLayer('navbar');
    // If a form input has focus, blur it — arrow keys would otherwise
    // move the caret inside the input instead of walking tabs (the
    // capture-phase handler below would still preventDefault, but the
    // visual cursor in the field is misleading).
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
      el.blur();
    }
  }, []);
  const enterContentLayer = useCallback(() => setLayer('content'), []);
  const registerNavbarEscapeGuard = useCallback((guard: (() => boolean) | null) => {
    navbarEscapeGuardRef.current = guard;
  }, []);

  // ─── Navbar layer handler ────────────────────────────────────────────
  // While the navbar layer is active, intercept keys at capture phase so
  // they win against the practice page's typing listener and any page
  // bindings. Arrow keys walk between tabs; Enter / Esc drop back to
  // content; modifiers and ? flow through so global help still works;
  // every other key is swallowed so stray keystrokes don't bleed into
  // pages while the user is "in the navbar".
  useEffect(() => {
    if (layer !== 'navbar') return;
    const handler = (e: KeyboardEvent) => {
      // Allow modifier-only keypresses through (e.g. Shift held while
      // reaching for `?`).
      if (
        e.code === 'ShiftLeft' || e.code === 'ShiftRight' ||
        e.code === 'ControlLeft' || e.code === 'ControlRight' ||
        e.code === 'AltLeft' || e.code === 'AltRight' ||
        e.code === 'MetaLeft' || e.code === 'MetaRight'
      ) return;

      // ? (Shift+/) → let the global keymap toggle the help overlay.
      if (e.code === 'Slash' && e.shiftKey) return;

      if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
        e.preventDefault();
        e.stopImmediatePropagation();
        const idx = findTabIndex(pathname);
        const delta = e.code === 'ArrowLeft' ? -1 : 1;
        const next = (idx + delta + NAV_TABS.length) % NAV_TABS.length;
        navigate(NAV_TABS[next].to);
        return;
      }

      if (e.code === 'Enter' || e.code === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        setLayer('content');
        return;
      }

      // Anything else: eat it. The user is "in the navbar"; we don't
      // want a stray letter to type into Practice or trigger a page
      // shortcut.
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [layer, navigate, pathname]);

  // Click anywhere outside the nav while in navbar layer → drop to content.
  useEffect(() => {
    if (layer !== 'navbar') return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (target?.closest('[data-navbar-layer-root]')) return;
      setLayer('content');
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [layer]);

  // ─── Tab prefetch ───────────────────────────────────────────────────
  // When the user enters the navbar layer, warm the cache for every tab
  // they might arrow-walk to. With a 30s default staleTime and the
  // active-layout-scoped keys already populated by whichever page is
  // mounted, a single prefetch round on layer entry is enough to keep
  // arrow-key tab switching from re-fetching.
  useEffect(() => {
    if (layer !== 'navbar') return;
    void (async () => {
      try {
        const user = await queryClient.ensureQueryData({
          queryKey: ['user'],
          queryFn: fetchUser,
        });
        const layoutId = user?.layout_progress[0]?.layout_id;
        const tasks: Promise<unknown>[] = [
          queryClient.prefetchQuery({
            queryKey: ['layouts', 'summary'],
            queryFn: fetchLayoutSummary,
          }),
        ];
        if (layoutId) {
          tasks.push(
            queryClient.prefetchQuery({
              queryKey: ['sessions', layoutId],
              queryFn: () => fetchSessions(layoutId),
            }),
            queryClient.prefetchQuery({
              queryKey: ['ngramStats', layoutId],
              queryFn: () => fetchNgramStats(layoutId),
            }),
          );
        }
        await Promise.allSettled(tasks);
      } catch {
        // Prefetch is best-effort — a failure here just means the
        // tabs will fetch on visit like they would have anyway.
      }
    })();
  }, [layer, queryClient]);

  // ─── Global bindings ────────────────────────────────────────────────
  const toggleHelp = useCallback(() => setIsHelpOpen((v) => !v), []);

  // `?` is the only global binding subscribed via the document-level
  // keymap. It's suppressed while the navbar layer or help overlay is
  // active — both install their own capture-phase handlers.
  const helpBinding = useMemo<Keybinding>(
    () => ({
      id: 'global.help',
      code: 'Slash',
      modifiers: new Set(['shift']),
      description: 'Show keyboard shortcuts',
      handler: toggleHelp,
      allowInInput: false,
    }),
    [toggleHelp],
  );
  // Esc is a documentation-only entry: the actual handler is the
  // window-level effect below, deliberately wired so any page that
  // claims Esc on `document` (e.g. Practice's "end session") wins.
  const escDocBinding = useMemo<Keybinding>(
    () => ({
      id: 'global.enter-navbar',
      code: 'Escape',
      description: 'Focus the navbar (←/→ to walk tabs, Enter to return)',
      handler: enterNavbarLayer,
      allowInInput: true,
    }),
    [enterNavbarLayer],
  );
  const globalBindings = useMemo(
    () => [helpBinding, escDocBinding],
    [helpBinding, escDocBinding],
  );
  const subscribedGlobalBindings = useMemo(() => [helpBinding], [helpBinding]);
  useKeymap(subscribedGlobalBindings, layer === 'content' && !isHelpOpen);

  // ─── Esc → enter navbar layer ───────────────────────────────────────
  // Capture-phase, document-level: gives pages a chance to claim Esc
  // before navbar focus while keeping the idle navbar gesture global.
  // We deliberately don't call `stopImmediatePropagation` — idle page
  // handlers can still observe the keypress and no-op.
  useEffect(() => {
    if (layer !== 'content' || isHelpOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code !== 'Escape') return;
      if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      // Skip when there is no navbar mounted (e.g. /onboarding) —
      // entering the navbar layer would silently swallow keystrokes
      // with no visible affordance.
      if (!document.querySelector('[data-navbar-layer-root]')) return;
      const guard = navbarEscapeGuardRef.current;
      if (guard && !guard()) return;
      enterNavbarLayer();
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [layer, isHelpOpen, enterNavbarLayer]);

  // While the help overlay is open, Esc and `?` both close it. Handled
  // at capture phase + stopImmediatePropagation so the keypress does NOT
  // also reach page bindings (e.g. Esc would otherwise also end the
  // practice session as it dismisses the help overlay).
  useEffect(() => {
    if (!isHelpOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || (e.code === 'Slash' && e.shiftKey)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setIsHelpOpen(false);
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isHelpOpen]);

  const value = useMemo<KeymapContextValue>(
    () => ({
      registry: { global: globalBindings, page: pageSection },
      registerPage: setPageSection,
      openHelp: () => setIsHelpOpen(true),
      isHelpOpen,
      layer,
      enterNavbarLayer,
      enterContentLayer,
      registerNavbarEscapeGuard,
    }),
    [
      globalBindings,
      pageSection,
      isHelpOpen,
      layer,
      enterNavbarLayer,
      enterContentLayer,
      registerNavbarEscapeGuard,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Pages call this to register their keybindings AND get them subscribed
 * in one step. The bindings show up in the help overlay under the given
 * section title.
 */
export function useRegisterPageKeymap(
  title: string,
  bindings: readonly Keybinding[],
  enabled: boolean = true,
): void {
  const { registerPage } = useKeymapRegistry();
  useKeymap(bindings, enabled);
  useEffect(() => {
    if (!enabled) {
      registerPage(null);
      return;
    }
    registerPage({ title, bindings });
    return () => registerPage(null);
  }, [title, bindings, enabled, registerPage]);
}
