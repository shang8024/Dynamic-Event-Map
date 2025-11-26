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
        "z-10 rounded-md px-2 py-0.5 text-xs font-semibold",
        isInProgress ? "border border-emerald-200 bg-emerald-100 text-emerald-800" : "",
        isExpired ? "border border-slate-300 bg-slate-200 text-slate-700" : "",
      ].join(" ")}
    >
      {displayStatus}
    </span>
  );
}
