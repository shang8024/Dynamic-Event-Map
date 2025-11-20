import React from "react";

const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

export default function EventImage({ event, fallbackSeed }) {
  if (!event) return null;

  const hasPosition = 
    event.position && 
    typeof event.position.lat === "number" && 
    typeof event.position.lng === "number";

  const googleStreetView = hasPosition && API_KEY
    ? `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${event.position.lat},${event.position.lng}&fov=90&heading=235&pitch=10&key=${API_KEY}`
    : null;

  const startsAt = event.startsAt || event._row?.starts_at;
  const endsAt = event.endsAt || event._row?.ends_at;
  const eventId = event.id || fallbackSeed || 'default';

  return (
    <div className="flex-none w-40 md:w-56 aspect-[4/3]">
      <img
        src={event.img || googleStreetView || `https://picsum.photos/seed/${eventId}/400/300`}
        alt={event.title || "Event"}
        className="h-full w-full rounded object-cover"
      />
      {startsAt && (
        <div className="mt-1 text-xs text-base-content/50">
          <strong>Starts:</strong> {new Date(startsAt).toLocaleDateString()}
        </div>
      )}
      {endsAt && (
        <div className="mt-1 text-xs text-base-content/50">
          <strong>Ends:</strong> {new Date(endsAt).toLocaleDateString()}
        </div>
      )}
    </div>
  );
}
