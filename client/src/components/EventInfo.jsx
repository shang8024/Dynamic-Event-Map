import React from "react";
import { useBookmarks } from "../hooks";

export default function EventInfo({ event, onClose}) {
  const { isBookmarked, toggle } = useBookmarks();
  
  if (!event) return null;

  const bookmarked = isBookmarked(event.id);

  const handleBookmark = () => {
    toggle(event.id, undefined, event);
  };

  return (
    <div className="bg-base-200 border-base-300 flex h-full w-full flex-col border-l p-4">
      <div className="bg-base-100 w-full overflow-hidden rounded-md relative">
        <img
          src={event.img || `https://picsum.photos/seed/${event.id}/800/400`}
          alt={event.title}
          className="h-56 w-full object-cover"
        />

          <button
            className={`absolute top-2 right-2 btn btn-circle btn-sm focus:outline-none ${bookmarked ? 'btn-error' : 'btn-ghost bg-white/80 hover:bg-white hover:btn-error'}`}
            onClick={handleBookmark}
            title={bookmarked ? 'Remove from bookmarks' : 'Add to bookmarks'}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" className={`w-4 h-4 ${bookmarked ? 'icon-filled' : 'icon-outline'}`}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
            </svg>
          </button>
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
