import React from "react";
import { useNotifications } from "../contexts/NotificationContext.jsx";

const toneCls = {
  info: "bg-slate-50 border-slate-200",
  success: "bg-emerald-50 border-emerald-200",
  warning: "bg-amber-50 border-amber-200",
  error: "bg-rose-50 border-rose-200",
};

export default function NotificationBanner() {
  const { items, dismiss } = useNotifications();
  return (
    <div className="fixed top-3 left-1/2 z-1000 flex w-full max-w-3xl -translate-x-1/2 flex-col gap-2 px-3">
      {items.map((n) => (
        <Banner
          key={n.id}
          n={n}
          onClose={() => dismiss(n.id, n.stickyKey)}
          autoCloseMs={n.autoCloseMs}
        />
      ))}
    </div>
  );
}

function Banner({ n, onClose, autoCloseMs = 0 }) {
  const [closing, setClosing] = React.useState(false);

  // optional auto-close
  React.useEffect(() => {
    if (!autoCloseMs) return;
    const t = setTimeout(() => handleClose(), autoCloseMs);
    return () => clearTimeout(t);
  }, [autoCloseMs, handleClose]);

  function handleClose() {
    // trigger fade-out first, then call onClose
    setClosing(true);
    setTimeout(() => onClose?.(), 300); // keep in sync with duration-300 below
  }

  return (
    <div
      className={[
        "rounded-xl border px-4 py-3 shadow",
        toneCls[n.type] || toneCls.info,
        "transition-opacity duration-300",
        closing ? "opacity-0" : "opacity-100",
      ].join(" ")}
    >
      <div className="flex items-center gap-3">
        {/* Dot wrapper ensures perfect vertical centering */}
        <div className="flex h-5 w-5 flex-none items-center justify-center">
          <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
        </div>

        <div className="min-w-0 flex-1">
          {n.title && (
            <p className="truncate leading-tight font-medium text-slate-900">{n.title}</p>
          )}
          {n.message && <p className="mt-0.5 text-sm leading-snug text-slate-800">{n.message}</p>}
        </div>
        <div className="flex flex-shrink-0 flex-row items-center">
          {n.action && (
            <div className="flex flex-col gap-2">
              <a
                className="rounded-md bg-slate-700 px-3 py-1 text-sm text-white hover:bg-slate-800"
                href={n.action.href}
                role={!n.action.href ? "button" : undefined}
                aria-label={n.action.ariaLabel || undefined}
                tabIndex={0}
                onClick={(e) => {
                  if (typeof n.action.onClick === "function") {
                    n.action.onClick(e);
                  }
                  // If no href, prevent default to act as a button
                  if (!n.action.href) {
                    e.preventDefault();
                  }
                }}
                onKeyDown={(e) => {
                  if (!n.action.href && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    if (typeof n.action.onClick === "function") {
                      n.action.onClick(e);
                    }
                  }
                }}
              >
                {n.action.label}
              </a>
            </div>
          )}
          <button
            className="ml-2 rounded-md px-2 py-1 text-sm text-slate-700 hover:bg-white/60"
            onClick={handleClose}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  );
}
