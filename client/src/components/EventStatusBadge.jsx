import React from "react";
import { getEventStatus } from "../utils/date";

export default function EventStatusBadge({ event, status, position = "absolute left-4 top-4" }) {
  const displayStatus = status || (event ? getEventStatus(event) : null);
  
  if (!displayStatus) return null;

  const isInProgress = displayStatus === "In progress";
  const isExpired = displayStatus === "Expired";

  return (
    <span
      className={[
        position,
        "rounded-md px-2 py-0.5 text-xs font-semibold z-10",
        isInProgress ? "bg-emerald-100 text-emerald-800 border border-emerald-200" : "",
        isExpired ? "bg-slate-200 text-slate-700 border border-slate-300" : "",
      ].join(" ")}
    >
      {displayStatus}
    </span>
  );
}
