import React, { useState, useCallback, useMemo } from "react";
import { useBookmarks } from "../../hooks";
import { getEventStatus, normalize } from "../../utils/date";
import EventStatusBadge from "../../components/EventStatusBadge";
import EventImage from "../../components/EventImage";
import SearchInput from "../../components/SearchInput";
import EmptyState from "../../components/EmptyState";
import Description from "../../components/Description";

const BookmarkListItem = ({ id, eventData, bookmarkInfo, toggle, pending }) => {
  const eventStatus = getEventStatus(eventData);
  const isExpired = eventStatus === "Expired";
  const stop = (e) => e.stopPropagation();
  return (
    <div
      key={id}
      className={[
        "card bg-base-200 relative w-full shadow-sm transition",
        isExpired ? "opacity-60 grayscale" : "",
      ].join(" ")}
    >
      <EventStatusBadge event={eventData} position="absolute left-4 top-4" />

      <div className="card-body p-3 md:p-4">
        <div className="flex flex-col items-start gap-4 md:flex-row">
          {/* Image column */}
          {eventData && (
            <EventImage
              event={eventData}
              className="mb-2 aspect-[4/3] w-full flex-none md:mb-0 md:aspect-[4/3] md:w-40"
            />
          )}

          {/* Details */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="card-title text-base md:text-lg">
                  {eventData?.title || `Event ${id}`}
                </h3>
                {/* Collapsible description */}
                {eventData?.description && (
                  <Description text={eventData.description} valid={!isExpired} />
                )}
                {eventData?._row?.location_address && (
                  <p className="text-base-content/50 mt-1 text-xs">
                    {eventData._row.location_address}
                  </p>
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
                className={`btn btn-sm ${pending ? "btn-disabled" : "btn-ghost"} text-error ml-auto md:ml-0`}
                onClick={(e) => {
                  stop(e);
                  if (!pending) toggle(id, false);
                }}
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
                    {isExpired ? (
                      <path d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 11-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" />
                    ) : (
                      <path d="m11.645 20.91-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.218l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z" />
                    )}
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

  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("bookmarked-desc");
  const filteredSorted = useMemo(() => {
    // Filter by search & hideExpired
    const matches = bookmarkedEvents.filter(({ eventData }) => {
      if (!eventData) return false;

      if (!q) return true;
      const hay = [eventData.title, eventData.description, eventData?._row?.location_address]
        .map(normalize)
        .join(" ");

      return hay.includes(normalize(q));
    });

    const withFields = matches.map((row) => {
      const starts = row.eventData?._row?.starts_at ? new Date(row.eventData._row.starts_at) : null;
      const ends = row.eventData?._row?.ends_at ? new Date(row.eventData._row.ends_at) : null;
      return { ...row, __starts: starts, __ends: ends };
    });

    withFields.sort((a, b) => {
      switch (sortKey) {
        case "title-asc":
          return normalize(a.eventData?.title).localeCompare(normalize(b.eventData?.title));
        case "title-desc":
          return normalize(b.eventData?.title).localeCompare(normalize(a.eventData?.title));
        case "starts-asc": {
          const av = a.__starts ? a.__starts.getTime() : Number.MAX_SAFE_INTEGER;
          const bv = b.__starts ? b.__starts.getTime() : Number.MAX_SAFE_INTEGER;
          return av - bv;
        }
        case "ends-asc": {
          const av = a.__ends ? a.__ends.getTime() : Number.MAX_SAFE_INTEGER;
          const bv = b.__ends ? b.__ends.getTime() : Number.MAX_SAFE_INTEGER;
          return av - bv;
        }
        case "bookmarked-desc":
        default:
          return new Date(b.bookmarkInfo.updatedAt) - new Date(a.bookmarkInfo.updatedAt);
      }
    });

    return withFields;
  }, [bookmarkedEvents, q, sortKey]);

  const expiredCount = useMemo(
    () =>
      bookmarkedEvents.filter(({ eventData }) => getEventStatus(eventData) === "Expired").length,
    [bookmarkedEvents]
  );

  // Bulk remove expired
  const removeExpired = useCallback(async () => {
    if (!expiredCount) return;
    const ok = window.confirm(`Remove ${expiredCount} expired bookmark(s)?`);
    if (!ok) return;

    const tasks = bookmarkedEvents
      .filter(({ eventData }) => getEventStatus(eventData) === "Expired")
      .map(({ id }) => toggle(id, false));
    await Promise.allSettled(tasks);
  }, [bookmarkedEvents, expiredCount, toggle]);
  return (
    <div className="card bg-base-100">
      <div className="card-body">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="card-title">Bookmarked Events</h2>
            <p className="text-sm opacity-70">
              {bookmarkedEvents.length} total · {expiredCount} expired
            </p>
          </div>

          {/* Toolbar */}
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
            {/* Search */}
            <SearchInput value={q} onChange={setQ} />

            {/* Sort */}
            <select
              className="select select-sm w-full"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              title="Sort by"
            >
              <option value="bookmarked-desc">Recently bookmarked</option>
              <option value="starts-asc">Starts soon</option>
              <option value="ends-asc">Ends soon</option>
              <option value="title-asc">Title A–Z</option>
              <option value="title-desc">Title Z–A</option>
            </select>

            {/* Remove expired */}
            <button
              type="button"
              className="btn btn-sm btn-outline btn-error"
              disabled={!expiredCount}
              onClick={removeExpired}
              title={expiredCount ? "Remove all expired bookmarks" : "No expired bookmarks"}
            >
              Remove expired
            </button>
          </div>
        </div>

        {/* Display bookmarked events */}
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredSorted.length === 0 ? (
            <EmptyState
              message={q ? "No bookmarked events match your search." : "No bookmarked events yet."}
            />
          ) : (
            filteredSorted.map(({ id, eventData, bookmarkInfo }) => (
              <BookmarkListItem
                key={id}
                id={id}
                eventData={eventData}
                bookmarkInfo={bookmarkInfo}
                toggle={toggle}
                pending={isPending(id)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
