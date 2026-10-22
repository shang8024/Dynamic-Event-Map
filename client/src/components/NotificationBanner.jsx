import {useCallback, useEffect, useRef, useState} from 'react';
import {useNotifications} from '../contexts/NotificationContext.jsx';
import useNotificationAutoDismiss from '../hooks/useNotificationAutoDismiss';

const titles = {info: 'Update', success: 'Done', warning: 'Please check', error: 'Something went wrong'};

export default function NotificationBanner() {
  const {items, dismiss, autoDismissEnabled} = useNotifications();
  const closeButton = useRef(null), returnFocus = useRef(false);
  const current = items[0];
  useEffect(() => {
    if (returnFocus.current) {
      returnFocus.current = false;
      closeButton.current?.focus({preventScroll: true});
    }
  }, [current?.id]);
  const close = useCallback((id, stickyKey) => {
    returnFocus.current = document.activeElement === closeButton.current;
    dismiss(id, stickyKey);
  }, [dismiss]);
  if (!current) return null;

  return <div className="notification-tray" aria-label="Status messages">
    {items.length > 2 && <div className="notification-stack-layer notification-stack-back" aria-hidden="true"/>}
    {items.length > 1 && <div className="notification-stack-layer notification-stack-middle" aria-hidden="true"/>}
    <Banner key={current.id} n={current} count={items.length} dismiss={close} closeButton={closeButton} autoDismissEnabled={autoDismissEnabled}/>
  </div>;
}

function Banner({n, count, dismiss, closeButton, autoDismissEnabled}) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const close = useCallback(() => dismiss(n.id, n.stickyKey), [dismiss, n.id, n.stickyKey]);
  useNotificationAutoDismiss(n, autoDismissEnabled, close, hovered || focused);
  const tone = Object.hasOwn(titles, n.type) ? n.type : 'info';

  return <div className={`notification-card notification-tone-${tone}`}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)}
    onBlurCapture={event => {if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);}}>
    <div className="notification-card-body" role={tone === 'warning' || tone === 'error' ? 'alert' : 'status'} aria-atomic="true">
      <svg className="notification-status-icon" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {tone === 'success' ? <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></> : <><circle cx="12" cy="12" r="9"/>{tone === 'info' ? <path d="M12 11v6m0-10h.01"/> : <path d="M12 7v6m0 4h.01"/>}</>}
      </svg>
      <div className="notification-copy">
        {count > 1 && <p className="notification-stack-count">{count} notifications</p>}
        <p className="notification-title">{n.title || titles[tone]}</p>
        {n.message && <p className="notification-description">{n.message}</p>}
      </div>
    </div>
    <button ref={closeButton} type="button" className="notification-dismiss" onClick={close} aria-label="Dismiss notification" title="Dismiss notification">
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg>
    </button>
    {n.action && <div className="notification-action">
      {n.action.href ? <a href={n.action.href} aria-label={n.action.ariaLabel} onClick={n.action.onClick}>{n.action.label}</a> : <button type="button" aria-label={n.action.ariaLabel} onClick={n.action.onClick}>{n.action.label}</button>}
    </div>}
  </div>;
}
