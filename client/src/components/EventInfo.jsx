import React from "react";

export default function EventInfo({ event, onClose }) {
  if (!event) return null;

  return (
    <div className="bg-base-200 border-base-300 flex h-full w-full flex-col border-l p-4">
      <div className="bg-base-100 w-full overflow-hidden rounded-md">
        <img
          src={event.img || `https://picsum.photos/seed/${event.id}/800/400`}
          alt={event.title}
          className="h-56 w-full object-cover"
        />
      </div>

      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <h3 className="text-lg font-semibold">{event.title}</h3>
          <div className="text-base-content/60 mt-1 text-sm">{event.description}</div>
          <div className="text-base-content/50 mt-3 text-xs">
            <div>Lat: {event.position.lat.toFixed(5)}</div>
            <div>Lng: {event.position.lng.toFixed(5)}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="space-x-2">
            <button
              className="btn btn-sm btn-primary"
              onClick={() =>
                window.open(
                  `https://www.google.com/maps/search/?api=1&query=${event.position.lat},${event.position.lng}`,
                  "_blank"
                )
              }
            >
              Open in Maps
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() =>
                navigator.clipboard?.writeText(`${event.position.lat},${event.position.lng}`)
              }
            >
              Copy coords
            </button>
          </div>
          <button className="btn btn-sm" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
