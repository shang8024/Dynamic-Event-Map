import React from "react";
import EventArtwork from "./EventArtwork.jsx";

export default function EventImage({ event, className }) {
  if (!event) return null;

  const startsAt = event.startsAt || event._row?.starts_at;
  const endsAt = event.endsAt || event._row?.ends_at;

  const imageWrapperClass = className || "aspect-[4/3] w-40 flex-none md:w-56";

  return (
    <div>
      <div className={imageWrapperClass}>
        <EventArtwork src={event.img} title={event.title} className="h-full w-full rounded" />
      </div>

      {startsAt && (
        <div className="text-base-content/50 mt-1 text-xs">
          <strong>Starts:</strong> {new Date(startsAt).toLocaleDateString()}
        </div>
      )}
      {endsAt && (
        <div className="text-base-content/50 mt-1 text-xs">
          <strong>Ends:</strong> {new Date(endsAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
