import { useEffect, useRef } from 'react';

/**
 * Layout-agnostic keymap utilities.
 *
 * Every shortcut in the app is bound by `KeyboardEvent.code` (the physical
 * key position on the keyboard, e.g. `KeyG`, `Slash`, `Backquote`) instead
 * of `KeyboardEvent.key` (the logical character produced by the active OS
 * layout). This means a user practicing Colemak still hits the same
 * physical keys for navigation as a QWERTY user — the shortcut "g" lives
 * at the QWERTY-G position regardless of what the OS thinks that key
 * produces today.
 *
 * The same `event.code` strategy is used by the typing engine
 * (see `packages/shared/src/inputMode.ts`), so the two systems share a
 * coordinate space.
 */

export type Modifier = 'ctrl' | 'shift' | 'alt' | 'meta';

/**
 * Display name for a `KeyboardEvent.code` value. Always renders the
 * QWERTY-position label so the on-screen kbd hints match what the user
 * sees printed on their physical keyboard regardless of layout.
 */
export function codeLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3); // KeyG -> G
  if (code.startsWith('Digit')) return code.slice(5); // Digit1 -> 1
  switch (code) {
    case 'Backquote': return '`';
    case 'Slash': return '/';
    case 'Backslash': return '\\';
    case 'Comma': return ',';
    case 'Period': return '.';
    case 'Semicolon': return ';';
    case 'Quote': return "'";
    case 'BracketLeft': return '[';
    case 'BracketRight': return ']';
    case 'Minus': return '-';
    case 'Equal': return '=';
    case 'ArrowUp': return '↑';
    case 'ArrowDown': return '↓';
    case 'ArrowLeft': return '←';
    case 'ArrowRight': return '→';
    case 'Space': return 'Space';
    case 'Enter': return 'Enter';
    case 'Escape': return 'Esc';
    case 'Tab': return 'Tab';
    case 'Backspace': return 'Bksp';
    default: return code;
  }
}

export interface Keybinding {
  /** Either an `event.code` value or one of the special tokens above. */
  code: string;
  /** Required modifier set; keys not present must NOT be held. */
  modifiers?: ReadonlySet<Modifier>;
  /** Human description shown in the help overlay. */
  description: string;
  /** Stable id for tooltip / debug. */
  id: string;
  /** Run this when the keybinding fires. */
  handler: (e: KeyboardEvent) => void;
  /**
   * Whether this binding is enabled when an `<input>` / `<textarea>` is
   * focused. Defaults to false (skip while typing into form fields).
   */
  allowInInput?: boolean;
  /**
   * Don't preventDefault — useful when the handler still wants the
   * browser default to run (e.g. for `Tab` focus traversal).
   */
  passthrough?: boolean;
}

function isInputFocused(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

function modifiersMatch(
  e: KeyboardEvent,
  required: ReadonlySet<Modifier> | undefined,
): boolean {
  const wantsCtrl = required?.has('ctrl') ?? false;
  const wantsShift = required?.has('shift') ?? false;
  const wantsAlt = required?.has('alt') ?? false;
  const wantsMeta = required?.has('meta') ?? false;
  return (
    e.ctrlKey === wantsCtrl &&
    e.shiftKey === wantsShift &&
    e.altKey === wantsAlt &&
    e.metaKey === wantsMeta
  );
}

/**
 * Subscribe a list of keybindings to the document-level keydown stream.
 *
 * Bindings are matched in order: the first match runs and consumes the
 * event (preventDefault + stopPropagation, unless `passthrough`). This
 * lets pages register their own bindings without worrying about a global
 * shortcut sniping them — page bindings run first because they're hooked
 * at the document level by the page itself, while the global provider
 * subscribes earlier in the React tree.
 *
 * The bindings array is captured by ref so swapping the array doesn't
 * tear down/re-attach the listener every render.
 */
export function useKeymap(
  bindings: readonly Keybinding[] | (() => readonly Keybinding[]),
  enabled: boolean = true,
): void {
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const list = typeof ref.current === 'function' ? ref.current() : ref.current;
      const inInput = isInputFocused();
      for (const b of list) {
        if (b.code !== e.code) continue;
        if (!modifiersMatch(e, b.modifiers)) continue;
        if (inInput && !b.allowInInput) continue;
        if (!b.passthrough) {
          e.preventDefault();
          // stopImmediatePropagation (not just stopPropagation) so that
          // a matching page-level binding cleanly suppresses any global
          // binding registered on the same document — both listeners
          // sit on `document`, so plain stopPropagation wouldn't stop
          // sibling listeners from also firing.
          e.stopImmediatePropagation();
        }
        b.handler(e);
        return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled]);
}

/** Set helper for declaring modifier requirements concisely. */
export function mods(...m: Modifier[]): ReadonlySet<Modifier> {
  return new Set(m);
}
