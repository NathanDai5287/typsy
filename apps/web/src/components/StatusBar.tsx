import { useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { fetchUser, fetchLayouts } from '../lib/api.ts';
import { useKeymapRegistry } from '../lib/keymapContext.tsx';

/**
 * Bottom-anchored status bar inspired by tmux/vim. Shows where you are
 * (left) and the keymap hints relevant to the active focus layer
 * (right). Single line, no animations, sits below the page chrome so
 * the keyboard-driven flow always knows what's possible without opening
 * the help overlay.
 */
export default function StatusBar(): JSX.Element {
  const { pathname } = useLocation();
  const { data: user } = useQuery({ queryKey: ['user'], queryFn: fetchUser });
  const { data: layouts } = useQuery({ queryKey: ['layouts'], queryFn: fetchLayouts });
  const { layer } = useKeymapRegistry();

  // The server returns `layout_progress[0]` as the active layout (most
  // recently set via `POST /user/active-layout`).
  const activeLayoutId = user?.layout_progress[0]?.layout_id;
  const activeLayout = layouts?.find((l) => l.id === activeLayoutId);

  const route = pathname === '/' ? 'practice' : pathname.replace(/^\//, '');
  const navbarActive = layer === 'navbar';

  return (
    <footer className="fixed bottom-0 inset-x-0 z-30 h-7 bg-bg_h border-t border-bg4 flex items-center justify-between px-3 text-[11px] font-mono select-none">
      <div className="flex items-center gap-2 text-fg2">
        <span className="text-yellow-400">typsy</span>
        <span className="text-fg4">·</span>
        <span className="text-fg_h">{route}</span>
        {activeLayout && (
          <>
            <span className="text-fg4">·</span>
            <span className="text-fg2">layout:</span>
            <span className="text-fg_h">{activeLayout.name}</span>
          </>
        )}
        <span className="text-fg4">·</span>
        <span
          className={
            navbarActive
              ? 'text-yellow-400 font-bold tracking-widest'
              : 'text-fg3 tracking-widest'
          }
        >
          {navbarActive ? '[NAV]' : '[CONTENT]'}
        </span>
      </div>
      <div className="flex items-center gap-3 text-fg3">
        {navbarActive ? (
          <>
            <span><kbd className="kbd">←</kbd>/<kbd className="kbd">→</kbd> tab</span>
            <span><kbd className="kbd">Enter</kbd> content</span>
            <span><kbd className="kbd">Esc</kbd> cancel</span>
          </>
        ) : (
          <>
            <span><kbd className="kbd">Esc</kbd> nav</span>
            <span><kbd className="kbd">?</kbd> help</span>
          </>
        )}
      </div>
    </footer>
  );
}
