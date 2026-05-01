import { useKeymapRegistry } from '../lib/keymapContext.tsx';
import { codeLabel, type Keybinding } from '../lib/keymap.ts';

/**
 * Full-screen help / shortcut reference. Toggled with `?` from anywhere.
 * Renders the global keymap plus whatever section the current page has
 * registered, so the same overlay always shows the bindings the user can
 * actually use right now.
 */
export default function HelpOverlay(): JSX.Element | null {
  const { registry, isHelpOpen, openHelp } = useKeymapRegistry();
  if (!isHelpOpen) return null;
  // No-op reference to silence "unused" warning while keeping the API
  // available for future entry points (e.g. a status-bar click).
  void openHelp;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-bg_h/85 backdrop-blur-[2px]"
    >
      <div className="panel w-full max-w-3xl mx-4 max-h-[80vh] overflow-auto">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bg4 px-4 py-2">
          <span className="text-yellow-400 font-mono text-sm">
            ── keymap ──
          </span>
          <span className="text-fg4 text-xs">Press <kbd className="kbd">?</kbd> or <kbd className="kbd">Esc</kbd> to close</span>
        </div>

        {/* Body */}
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 text-sm">
          {registry.page && (
            <Section title={registry.page.title} bindings={registry.page.bindings} />
          )}
          <Section title="Global" bindings={registry.global} />
          <ManualSection
            title="Navbar focus layer"
            rows={[
              ['Esc', 'Lift focus to the navbar from any page'],
              ['← / →', 'Walk between top tabs'],
              ['Enter', 'Drop back to the page content'],
              ['Esc', 'Cancel and return to content'],
            ]}
          />
          <ManualSection
            title="Practice typing"
            rows={[
              ['Type any letter', 'Counts toward the active session'],
              ['Esc', 'End the session and focus the navbar'],
              ['Tab', 'Toggle Flow ↔ Drill'],
              ['\\', 'Toggle on-screen keyboard'],
            ]}
          />
          <ManualSection
            title="Lists & forms"
            rows={[
              ['↑ ↓ / j k', 'Move selection'],
              ['Enter', 'Activate / confirm'],
              ['Esc', 'Cancel'],
            ]}
          />
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  bindings,
}: {
  title: string;
  bindings: readonly Keybinding[];
}): JSX.Element {
  return (
    <div>
      <h3 className="panel-heading text-yellow-400">{title}</h3>
      <ul className="space-y-1">
        {bindings.map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-3 py-0.5">
            <span className="text-fg1 truncate">{b.description}</span>
            <span className="flex items-center gap-1 shrink-0">
              {b.modifiers && b.modifiers.has('ctrl') && <kbd className="kbd">Ctrl</kbd>}
              {b.modifiers && b.modifiers.has('alt') && <kbd className="kbd">Alt</kbd>}
              {b.modifiers && b.modifiers.has('shift') && <kbd className="kbd">Shift</kbd>}
              {b.modifiers && b.modifiers.has('meta') && <kbd className="kbd">⌘</kbd>}
              <kbd className="kbd">{codeLabel(b.code)}</kbd>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ManualSection({
  title,
  rows,
}: {
  title: string;
  rows: readonly (readonly [string, string])[];
}): JSX.Element {
  return (
    <div>
      <h3 className="panel-heading text-yellow-400">{title}</h3>
      <ul className="space-y-1">
        {rows.map(([label, desc]) => (
          <li key={label} className="flex items-center justify-between gap-3 py-0.5">
            <span className="text-fg1">{desc}</span>
            <kbd className="kbd">{label}</kbd>
          </li>
        ))}
      </ul>
    </div>
  );
}
