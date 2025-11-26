import React from "react";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

export default function EventImage({ event, fallbackSeed, className }) {
  if (!event) return null;

  const hasPosition =
    event.position &&
    typeof event.position.lat === "number" &&
    typeof event.position.lng === "number";

  const googleStreetView =
    hasPosition && API_KEY
      ? `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${event.position.lat},${event.position.lng}&fov=90&heading=235&pitch=10&key=${API_KEY}`
      : null;

  const startsAt = event.startsAt || event._row?.starts_at;
  const endsAt = event.endsAt || event._row?.ends_at;
  const eventId = event.id || fallbackSeed || "default";

  const imageWrapperClass = className || "aspect-[4/3] w-40 flex-none md:w-56";

  return (
    <div>
      <div className={imageWrapperClass}>
        <img
          src={event.img || googleStreetView || `https://picsum.photos/seed/${eventId}/400/300`}
          alt={event.title || "Event"}
          className="h-full w-full rounded object-cover"
        />
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
