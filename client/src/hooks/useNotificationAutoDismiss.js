import {useEffect} from 'react';

export default function useNotificationAutoDismiss(notification, enabled, dismiss, paused) {
  // Only the visible card mounts this hook. Covered notifications keep their
  // place in the queue and receive a full reading interval when revealed.
  const routine = ['info', 'success'].includes(notification.type || 'info');
  const delay = enabled && routine && !notification.action && !notification.stickyKey && notification.autoCloseMs !== 0
    ? Math.max(8000, Number.isFinite(notification.autoCloseMs) ? notification.autoCloseMs : 8000) : 0;
  useEffect(() => {
    if (!delay || paused) return;
    let timer;
    const restart = () => {
      clearTimeout(timer);
      if (!document.hidden) timer = setTimeout(dismiss, delay);
    };
    restart();
    document.addEventListener('visibilitychange', restart);
    return () => {clearTimeout(timer);document.removeEventListener('visibilitychange', restart);};
  }, [delay, dismiss, paused]);
}
