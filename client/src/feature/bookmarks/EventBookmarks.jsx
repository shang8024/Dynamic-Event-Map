import React from "react";
import { Link } from "react-router-dom";
import { useBookmarks } from "../../hooks";
import Navbar from "../../components/Navbar.jsx";

const bookmarkListItem = (id, eventData, bookmarkInfo, toggle, pending) => {
  return (
    <div key={id} className="card bg-base-200 shadow-sm">
      <div className="card-body p-4">
        <div className="flex gap-4">
          {/* Event Image */}
          {eventData && (
            <div className="h-16 w-24 flex-shrink-0">
              <img
                src={eventData.img || `https://picsum.photos/seed/${id}/200/150`}
                alt={eventData.title || "Event"}
                className="h-full w-full rounded object-cover"
              />
            </div>
          )}

          {/* Event Details */}
          <div className="flex-1">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="card-title text-lg">{eventData?.title || `Event ${id}`}</h3>
                {eventData?.description && (
                  <p className="text-base-content/60 mt-1 text-sm">{eventData.description}</p>
                )}
                {eventData?.position && (
                  <p className="text-base-content/50 mt-2 text-xs">
                    📍 {eventData.position.lat.toFixed(4)}, {eventData.position.lng.toFixed(4)}
                  </p>
                )}
                <p className="text-base-content/40 mt-1 text-xs">
                  Bookmarked: {new Date(bookmarkInfo.updatedAt).toLocaleDateString()}
                </p>
              </div>
              <button
                className={`btn btn-sm ${pending ? "btn-disabled" : "btn-ghost"} text-error`}
                onClick={() => !pending && toggle(id, false)}
                disabled={pending}
                aria-busy={pending}
                title={pending ? "Removing..." : "Remove bookmark"}
              >
                {pending ? (
                  <span className="loading loading-spinner loading-xs" />
                ) : (
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    className="h-4 w-4"
                  >
                    <path d="m11.645 20.91-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.218l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z" />
                  </svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function BookmarksPage() {
  const { listBookmarkedEvents, toggle, isPending } = useBookmarks();
  const bookmarkedEvents = listBookmarkedEvents();

  return (
    <div className="flex h-screen flex-col">
      <Navbar />

      {/* Bookmarks Content */}
      <div className="flex-1 p-4">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Bookmarked Events</h2>
            <p>Your saved events will appear here.</p>

            {/* Display bookmarked events */}
            <div className="mt-4 grid gap-4">
              {bookmarkedEvents.length === 0 ? (
                <div className="alert alert-info">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    fill="none"
                    viewBox="0 0 24 24"
                    className="h-6 w-6 shrink-0 stroke-current"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="2"
                      d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    ></path>
                  </svg>
                  <span>No bookmarks yet. Start exploring and bookmark events you like!</span>
                </div>
              ) : (
                bookmarkedEvents.map(({ id, eventData, bookmarkInfo }) =>
                  bookmarkListItem(id, eventData, bookmarkInfo, toggle, isPending(id))
                )
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
