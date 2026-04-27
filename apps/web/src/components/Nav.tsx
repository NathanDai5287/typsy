import { NavLink } from 'react-router-dom';

/**
 * Terminal-style top nav. Each link shows its underlined shortcut letter
 * (the QWERTY-position letter for the `g <letter>` chord, also reachable
 * directly via `Shift+<letter>`). The active route is rendered in
 * inverted style so the eye finds it instantly.
 *
 * Visually the bar is one ASCII row: `typsy/ practice  dashboard  ...`
 * with a single bottom border separating it from the page body.
 */
const links: { to: string; label: string; shortcut: string; end?: boolean }[] = [
  { to: '/',           label: 'practice',  shortcut: 'p', end: true },
  { to: '/dashboard',  label: 'dashboard', shortcut: 'd' },
  { to: '/layouts',    label: 'layouts',   shortcut: 'l' },
  { to: '/fingering',  label: 'fingering', shortcut: 'f' },
  { to: '/optimize',   label: 'optimize',  shortcut: 'o' },
  { to: '/settings',   label: 'settings',  shortcut: 's' },
];

/**
 * Highlight the shortcut letter inside a label. We split on the first
 * occurrence (case-insensitive) so e.g. "practice" + "p" renders as
 * `[P]ractice` with the bracketed letter receiving the accent color.
 * When the link is active (inverted: yellow bg, dark text) we don't apply
 * the yellow accent so the letter stays visible instead of blending in.
 */
function renderLabel(label: string, shortcut: string, isActive: boolean): JSX.Element {
  const idx = label.toLowerCase().indexOf(shortcut.toLowerCase());
  if (idx < 0) {
    return <span>{label}</span>;
  }
  return (
    <>
      <span>{label.slice(0, idx)}</span>
      <span className={isActive ? 'font-bold' : 'text-yellow-400'}>{label[idx]}</span>
      <span>{label.slice(idx + 1)}</span>
    </>
  );
}

export default function Nav(): JSX.Element {
  return (
    <nav
      aria-label="Primary"
      className="border-b border-bg4 bg-bg_h px-4 h-9 flex items-center gap-1 text-sm select-none"
    >
      <span className="text-yellow-400 font-bold mr-3 tracking-wider">typsy</span>
      <span className="text-fg4 mr-2">/</span>
      {links.map(({ to, label, shortcut, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            [
              'px-2 py-0.5 transition-none focus-visible:outline-none focus-visible:bg-bg4',
              isActive
                ? 'text-bg_h bg-yellow-400'
                : 'text-fg2 hover:text-fg_h',
            ].join(' ')
          }
          title={`Shift+${shortcut.toUpperCase()} or g ${shortcut}`}
        >
          {({ isActive }) => renderLabel(label, shortcut, isActive)}
        </NavLink>
      ))}
    </nav>
  );
}
