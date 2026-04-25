/**
 * Settings page is intentionally minimal — most preferences (input mode,
 * appearance, finger fade) belong on their own dedicated pages or live
 * implicitly in the data model. This page exists as a forward slot.
 */
export default function SettingsPage(): JSX.Element {
  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <header className="mb-6">
        <h1 className="text-xl text-fg_h">settings</h1>
        <p className="text-fg3 text-sm mt-1">
          Preferences live here. Currently nothing to configure — typing
          mode, fingering, and layouts each have their own dedicated page.
        </p>
      </header>

      <section className="panel p-4 space-y-3 text-sm">
        <h2 className="panel-heading">Coming up</h2>
        <ul className="space-y-1 text-fg2">
          <li>• Adjustable muscle-memory fade strength</li>
          <li>• Light / dark / amber-on-black themes</li>
          <li>• Keymap remapping</li>
          <li>• Synthetic data toggle (currently env-only)</li>
        </ul>
      </section>
    </div>
  );
}
