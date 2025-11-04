import React from "react";
import { useBookmarks } from "../hooks";
import EventComments from "./EventComments.jsx";

export default function EventInfo({ event, onClose, onEdit, onDelete }) {
  const { isBookmarked, isPending, toggle } = useBookmarks();

  if (!event) return null;

  // Build a Google Street View image for the event location when possible.
  const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;
  const hasPosition = !!(
    event.position &&
    typeof event.position.lat === "number" &&
    typeof event.position.lng === "number"
  );
  // Prefer Street View image (gives an actual photographic view when available).
  const googleStreetView =
    hasPosition && API_KEY
      ? `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${event.position.lat},${event.position.lng}&fov=90&heading=235&pitch=10&key=${API_KEY}`
      : null;
  const bookmarked = isBookmarked(event.id);
  const pending = isPending(event.id);

  const handleBookmark = () => {
    if (!pending) toggle(event.id, undefined, event);
  };

  const handleEdit = () => {
    if (onEdit) onEdit(event);
  };

  const handleDelete = () => {
    if (!onDelete) return;
    if (!confirm("Delete this event?")) return;
    onDelete(event.id);
  };

  return (
    <div className="bg-base-200 border-base-300 flex h-full w-full flex-col border-l p-4">
      <div className="bg-base-100 relative w-full overflow-hidden rounded-md">
        <img
          src={googleStreetView || `https://picsum.photos/seed/${event.id}/800/400`}
          alt={event.title}
          className="h-56 w-full object-cover"
        />
        <button
          className={`btn btn-circle btn-sm absolute top-2 left-2 ${
            bookmarked ? "btn-neutral" : ""
          }`}
          onClick={handleBookmark}
          disabled={pending}
          aria-busy={pending}
          title={
            pending
              ? "Updating..."
              : bookmarked
              ? "Remove from bookmarks"
              : "Add to bookmarks"
          }
        >
          {pending ? (
            <span className="loading loading-spinner loading-xs" />
          ) : (
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="2.5"
              stroke="currentColor"
              className="size-[1.2em]"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z"
              />
            </svg>
          )}
        </button>

        <button
          className="btn btn-circle btn-sm absolute top-2 right-2"
          onClick={onClose}
          title="Close"
        >
          <svg width="14" height="14" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
            <path
              fill="currentColor"
              d="m4.818 4.111l-.707.707a.5.5 0 0 0 0 .707L6.586 8L4.11 10.475a.5.5 0 0 0 0 .707l.707.707a.5.5 0 0 0 .707 0L8 9.414l2.475 2.475a.5.5 0 0 0 .707 0l.707-.707a.5.5 0 0 0 0-.707L9.414 8l2.475-2.475a.5.5 0 0 0 0-.707l-.707-.707a.5.5 0 0 0-.707 0L8 6.586L5.525 4.11a.5.5 0 0 0-.707 0"
            />
          </svg>
        </button>
      </div>

      <div className="flex flex-1 flex-col justify-between p-4">
        <div>
          <div className="flex items-start justify-between">
            <h3 className="mr-3 text-lg font-semibold">{event.title}</h3>
            <div className="flex items-center space-x-2">
              <button className="btn btn-xs btn-outline" onClick={handleEdit} title="Edit event">
                Edit
              </button>
              <button className="btn btn-xs btn-outline btn-error" onClick={handleDelete} title="Delete event">
                Delete
              </button>
            </div>
          </div>

          <div className="text-base-content/50 mt-3 text-xs">
            <div>
              Lat: {event.position.lat.toFixed(5)}, Lng: {event.position.lng.toFixed(5)}
            </div>
          </div>
          <div className="text-base-content/60 mt-1 text-sm">{event.description}</div>
          <EventComments eventId={event.id} />
        </div>
      </div>
    </div>
  );
}
