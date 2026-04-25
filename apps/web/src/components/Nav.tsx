import { NavLink } from 'react-router-dom';

const links = [
  { to: '/', label: 'Practice' },
  { to: '/dashboard', label: 'Dashboard' },
  { to: '/layouts', label: 'Layouts' },
  { to: '/optimize', label: 'Optimize' },
  { to: '/settings', label: 'Settings' },
];

export default function Nav() {
  return (
    <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-6">
      <span className="text-blue-400 font-bold tracking-widest text-sm mr-4">TYPSY</span>
      {links.map(({ to, label }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          className={({ isActive }) =>
            [
              'text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded px-1',
              isActive ? 'text-white font-medium' : 'text-gray-400 hover:text-gray-200',
            ].join(' ')
          }
        >
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
