import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { Keybinding } from './keymap.ts';
import { useKeymap } from './keymap.ts';

/**
 * Global keymap registry + nav-leader engine.
 *
 * Two responsibilities:
 *   1. Keep a list of keybindings registered by every page so the help
 *      overlay (`?`) can render an accurate, up-to-date list.
 *   2. Run the "go" leader (KeyG → wait for next code → navigate) that
 *      lets users jump between pages from anywhere — including from the
 *      practice page, which captures most other letters as typed input.
 *
 * The leader timing window is short (1.5s). Pressing a non-matching key
 * during that window aborts the leader without consuming the keypress so
 * the user can resume typing.
 */

export interface KeymapSection {
  /** Section header in the help overlay (e.g. "Practice"). */
  title: string;
  /** Bindings to display under that header. */
  bindings: readonly Keybinding[];
}

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
  /** Whether the leader (KeyG) is currently armed. */
  isLeaderArmed: boolean;
}

const Ctx = createContext<KeymapContextValue | null>(null);

export function useKeymapRegistry(): KeymapContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useKeymapRegistry must be inside <KeymapProvider>');
  return v;
}

interface KeymapProviderProps {
  children: React.ReactNode;
}

export function KeymapProvider({ children }: KeymapProviderProps): JSX.Element {
  const navigate = useNavigate();
  const [pageSection, setPageSection] = useState<KeymapSection | null>(null);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [isLeaderArmed, setIsLeaderArmed] = useState(false);

  // ─── "go" leader ─────────────────────────────────────────────────────
  // Pressing KeyG (the QWERTY-G physical position) arms the leader. The
  // next keypress is interpreted as a nav target. Times out after 1.5s.
  // While armed, ALL keypresses are intercepted (so the practice page
  // doesn't eat the second key as a typed character).
  const armedRef = isLeaderArmed; // local copy for closure clarity
  useEffect(() => {
    if (!isLeaderArmed) return;
    const id = setTimeout(() => setIsLeaderArmed(false), 1500);
    return () => clearTimeout(id);
  }, [armedRef]);

  // The leader handler runs at the capture phase so it has priority over
  // everything else (including the practice page's keydown listener).
  useEffect(() => {
    if (!isLeaderArmed) return;
    const handler = (e: KeyboardEvent) => {
      // Allow modifier-only keypresses to flow through without breaking
      // the leader (e.g. user holds Shift to find the "?" key).
      if (
        e.code === 'ShiftLeft' || e.code === 'ShiftRight' ||
        e.code === 'ControlLeft' || e.code === 'ControlRight' ||
        e.code === 'AltLeft' || e.code === 'AltRight' ||
        e.code === 'MetaLeft' || e.code === 'MetaRight'
      ) return;

      // The leader is consuming this key — stop ALL other listeners on
      // document (capture and bubble) from also processing it. Without
      // stopImmediatePropagation a `g j` chord would still trigger the
      // bubble-phase `j` binding on a list page.
      e.preventDefault();
      e.stopImmediatePropagation();
      setIsLeaderArmed(false);

      switch (e.code) {
        case 'KeyP': navigate('/'); return;
        case 'KeyD': navigate('/dashboard'); return;
        case 'KeyL': navigate('/layouts'); return;
        case 'KeyF': navigate('/fingering'); return;
        case 'KeyO': navigate('/optimize'); return;
        case 'KeyS': navigate('/settings'); return;
        case 'Escape': return; // explicit cancel
        default: return; // any other key: just abort silently
      }
    };
    document.addEventListener('keydown', handler, true);
    return () => document.removeEventListener('keydown', handler, true);
  }, [isLeaderArmed, navigate]);

  // ─── Global bindings ────────────────────────────────────────────────
  // Registered with `useKeymap` here so they're always live. These bind
  // by code so they remain layout-agnostic.
  //
  // Esc is intentionally NOT bound here. Closing the help overlay on Esc
  // is handled by the capture-phase listener below (only active while
  // `isHelpOpen`), so Esc is free to mean "end session" / "clear
  // selection" / etc. on whatever page is currently mounted. A redundant
  // global Esc binding here would `stopImmediatePropagation` and shadow
  // every page-level Esc handler — which manifests as "Esc stops working
  // after I navigate away and come back" because the global listener
  // gets re-positioned ahead of the page's listener in the document's
  // bubble queue on remount.
  const armLeader = useCallback(() => setIsLeaderArmed(true), []);
  const toggleHelp = useCallback(() => setIsHelpOpen((v) => !v), []);

  const globalBindings: Keybinding[] = useMemo(
    () => [
      {
        id: 'global.help',
        code: 'Slash',
        modifiers: new Set(['shift']),
        description: 'Show keyboard shortcuts',
        handler: toggleHelp,
        allowInInput: false,
      },
      {
        id: 'global.leader',
        code: 'KeyG',
        description: 'Go to… (then press P/D/L/F/O/S)',
        handler: armLeader,
        allowInInput: false,
      },
      {
        id: 'global.go-practice',
        code: 'KeyP',
        modifiers: new Set(['shift']),
        description: 'Go to Practice (Shift+P)',
        handler: () => navigate('/'),
        allowInInput: false,
      },
      {
        id: 'global.go-dashboard',
        code: 'KeyD',
        modifiers: new Set(['shift']),
        description: 'Go to Dashboard (Shift+D)',
        handler: () => navigate('/dashboard'),
        allowInInput: false,
      },
      {
        id: 'global.go-layouts',
        code: 'KeyL',
        modifiers: new Set(['shift']),
        description: 'Go to Layouts (Shift+L)',
        handler: () => navigate('/layouts'),
        allowInInput: false,
      },
      {
        id: 'global.go-fingering',
        code: 'KeyF',
        modifiers: new Set(['shift']),
        description: 'Go to Fingering (Shift+F)',
        handler: () => navigate('/fingering'),
        allowInInput: false,
      },
      {
        id: 'global.go-optimize',
        code: 'KeyO',
        modifiers: new Set(['shift']),
        description: 'Go to Optimize (Shift+O)',
        handler: () => navigate('/optimize'),
        allowInInput: false,
      },
      {
        id: 'global.go-settings',
        code: 'KeyS',
        modifiers: new Set(['shift']),
        description: 'Go to Settings (Shift+S)',
        handler: () => navigate('/settings'),
        allowInInput: false,
      },
    ],
    [armLeader, toggleHelp, navigate],
  );

  // The leader-armed state suppresses the global "g"-prefix binding from
  // re-arming itself: the leader effect handles all keypresses while
  // armed, so we just disable the regular hook in that window.
  useKeymap(globalBindings, !isLeaderArmed && !isHelpOpen);

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
      isLeaderArmed,
    }),
    [globalBindings, pageSection, isHelpOpen, isLeaderArmed],
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
