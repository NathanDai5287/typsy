/**
 * Centered "Press Enter to focus" pill rendered while the navbar focus
 * layer is active. The blur of the page underneath is applied separately
 * by the App shell — this component is only the readable affordance that
 * sits crisply on top.
 *
 * Sized via a fixed viewport-centered container with a low z-index so
 * the sticky <Nav> (z-30) and HelpOverlay (z-50) still render over it.
 */
export default function NavbarFocusOverlay(): JSX.Element {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-20 flex items-center justify-center"
    >
      <span className="font-mono text-base text-fg_h bg-bg_h/85 px-4 py-1.5 border border-yellow-400 tracking-wider">
        Press <kbd className="kbd">Enter</kbd> to focus
      </span>
    </div>
  );
}
