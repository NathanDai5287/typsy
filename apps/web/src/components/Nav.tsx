import { NavLink } from 'react-router-dom';
import { useKeymapRegistry } from '../lib/keymapContext.tsx';

/**
 * Terminal-style top nav with two visible states:
 *   - Content layer (default): the active route is rendered in inverted
 *     style, the rest of the bar is muted. The user's keyboard input
 *     belongs to whichever page is mounted.
 *   - Navbar layer: the bar gets a yellow top accent and the active
 *     tab gains a block-cursor frame. Left/Right walk tabs, Enter drops
 *     back to content. Set up by `KeymapProvider`; this component just
 *     reflects the state.
 */
const links: { to: string; label: string; end?: boolean }[] = [
  { to: '/',           label: 'practice',  end: true },
  { to: '/dashboard',  label: 'dashboard' },
  { to: '/layouts',    label: 'layouts'   },
  { to: '/fingering',  label: 'fingering' },
  { to: '/optimize',   label: 'optimize'  },
  { to: '/settings',   label: 'settings'  },
];

export default function Nav(): JSX.Element {
  const { layer, enterContentLayer } = useKeymapRegistry();
  const navbarActive = layer === 'navbar';

  return (
    <nav
      aria-label="Primary"
      data-navbar-layer-root
      className={[
        'border-b px-4 h-9 flex items-center gap-1 text-sm select-none transition-colors',
        navbarActive
          ? 'bg-bg0 border-yellow-400 shadow-[inset_0_1px_0_0_rgba(250,189,47,0.6)]'
          : 'bg-bg_h border-bg4',
      ].join(' ')}
    >
      <span className="text-yellow-400 font-bold mr-3 tracking-wider">typsy</span>
      <span className="text-fg4 mr-2">/</span>
      {links.map(({ to, label, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={enterContentLayer}
          className={({ isActive }) =>
            [
              'relative px-2 py-0.5 transition-none focus-visible:outline-none',
              isActive
                ? navbarActive
                  ? 'text-bg_h bg-yellow-400 ring-1 ring-yellow-200 ring-offset-1 ring-offset-bg0'
                  : 'text-bg_h bg-yellow-400'
                : navbarActive
                  ? 'text-fg1 hover:text-fg_h'
                  : 'text-fg2 hover:text-fg_h',
            ].join(' ')
          }
        >
          {({ isActive }) => (
            <>
              {isActive && navbarActive && (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-x-0 -bottom-[2px] h-[2px] bg-yellow-400"
                />
              )}
              <span>{label}</span>
            </>
          )}
        </NavLink>
      ))}
      <span
        className={[
          'ml-auto font-mono text-[10px] tracking-widest uppercase px-1.5 py-0.5 border',
          navbarActive
            ? 'text-bg_h bg-yellow-400 border-yellow-400'
            : 'text-fg4 border-bg4',
        ].join(' ')}
        aria-live="polite"
      >
        {navbarActive ? 'nav' : 'content'}
      </span>
    </nav>
  );
}
