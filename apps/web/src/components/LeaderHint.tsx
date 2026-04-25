import { useKeymapRegistry } from '../lib/keymapContext.tsx';

/**
 * Small indicator that appears in the corner whenever the `g` leader is
 * armed (waiting for the second key of a navigation chord). Mirrors the
 * vim status-line hint that pops while typing a multi-key command.
 *
 * The indicator is non-interactive — focus is preserved on whatever the
 * user was on when they pressed `g`, so the next keystroke still routes
 * to the global capture handler in `KeymapProvider`.
 */
export default function LeaderHint(): JSX.Element | null {
  const { isLeaderArmed } = useKeymapRegistry();
  if (!isLeaderArmed) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-10 right-4 z-40 panel px-3 py-2 text-xs font-mono text-fg1 select-none"
    >
      <div className="flex items-center gap-2">
        <span className="text-yellow-400">g</span>
        <span className="text-fg4">→</span>
        <span className="text-fg2">
          <span className="text-fg_h">p</span>ractice ·
          <span className="text-fg_h"> d</span>ashboard ·
          <span className="text-fg_h"> l</span>ayouts ·
          <span className="text-fg_h"> f</span>ingering ·
          <span className="text-fg_h"> o</span>ptimize ·
          <span className="text-fg_h"> s</span>ettings
        </span>
      </div>
      <div className="text-[10px] text-fg4 mt-1">Esc to cancel · times out in 1.5s</div>
    </div>
  );
}
