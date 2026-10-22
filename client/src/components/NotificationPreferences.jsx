import {useNotifications} from '../contexts/NotificationContext';

export default function NotificationPreferences() {
  const {autoDismissEnabled, setAutoDismissEnabled} = useNotifications();
  return <section className="content-card preference-card" aria-labelledby="banner-preferences-heading">
    <h2 id="banner-preferences-heading" className="font-semibold">On-screen notifications</h2>
    <label className="mt-4 flex items-start justify-between gap-5">
      <span>
        <span id="banner-auto-dismiss-label" className="font-medium">Automatically dismiss routine updates</span>
        <span id="banner-preferences-help" className="mt-1 block text-sm muted">
          Info and success banners disappear after a short delay. Errors, warnings and messages with actions stay until you dismiss them.
        </span>
      </span>
      <input type="checkbox" role="switch" className="toggle toggle-primary mt-1 shrink-0"
        checked={autoDismissEnabled} onChange={event => setAutoDismissEnabled(event.target.checked)}
        aria-labelledby="banner-auto-dismiss-label" aria-describedby="banner-preferences-help banner-preferences-storage"/>
    </label>
    <p id="banner-preferences-storage" className="mt-4 text-xs muted">Saved automatically for this browser. Your inbox messages and email choices are unaffected.</p>
  </section>;
}
