import React, { useState, useCallback, useEffect, useMemo, useRef, useLayoutEffect } from "react";
import { useBookmarks } from "../../hooks";
const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

function status(eventData) {
  const now = new Date();
  const starts = eventData._row?.starts_at ? new Date(eventData._row.starts_at) : null;
  const ends = eventData._row?.ends_at ? new Date(eventData._row.ends_at) : null;
  let status = null;
  if (ends && ends < now) status = "Expired";
  else if (starts && starts <= now && (!ends || ends >= now)) status = "In progress";
  return status;
}

function normalize(s) {
  return (s || "").toString().toLowerCase();
}

function Description({ text, valid = true }) {
  const pRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [collapsedMax, setCollapsedMax] = useState(40);
  const [hasOverflow, setHasOverflow] = useState(false);
  useLayoutEffect(() => {
    const el = pRef.current;
    if (!el) return;
    const compute = () => {
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || 20;
      const limit = Math.round(lh * 3);
      setCollapsedMax(limit);
      setHasOverflow(el.scrollHeight > limit + 1);
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);
  return (
    <div className="mt-1 text-sm text-base-content/60">
      <div className="relative" style={{maxHeight: expanded ? "none" : `${collapsedMax}px`, overflow: "hidden"}}>
        <p ref={pRef}>{text}</p>
        {!expanded && hasOverflow && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 h-6 bg-gradient-to-t from-base-200 to-transparent" />
        )}
      </div>
      {hasOverflow && (
        <button
          className="mt-2 text-xs text-primary underline opacity-80 hover:opacity-100"
          disabled={!valid}
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((v) => !v);
          }}
          aria-label={expanded ? "Show less" : "Show more"}
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

const BookmarkListItem = ({id, eventData, bookmarkInfo, toggle, pending}) => {
  const [expanded, setExpanded] = useState(false);
  const descBoxRef = useRef(null);
  const [needsToggle, setNeedsToggle] = useState(false);
  const hasPosition = eventData && eventData.position && typeof eventData.position.lat === "number" && typeof eventData.position.lng === "number";
  const googleStreetView =
    hasPosition && API_KEY
      ? `https://maps.googleapis.com/maps/api/streetview?size=800x400&location=${eventData.position.lat},${eventData.position.lng}&fov=90&heading=235&pitch=10&key=${API_KEY}`
      : null;
  const eventStatus = status(eventData);
  const isExpired = eventStatus === "Expired";
  useEffect(() => {
    const el = descBoxRef.current;
    if (!el) return;
    const checkOverflow = () => {
      if (!el) return;
      const overflows = el.scrollHeight > el.clientHeight + 1;
      setNeedsToggle(overflows);
    };
    checkOverflow();
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [eventData?.description, expanded]);
  // const [expanded, setExpanded] = useState(false);
  const onRowClick = useCallback(() => {
    if (needsToggle) setExpanded((v) => !v);
  }, [needsToggle]);
  const stop = (e) => e.stopPropagation(); 
  return (
    <div
      key={id}
      className={[
        "card relative bg-base-200 shadow-sm transition",
        isExpired ? "grayscale opacity-60" : "",
      ].join(" ")}
      onClick={onRowClick}
      role={needsToggle ? "button" : undefined}
      tabIndex={needsToggle ? 0 : -1}
      aria-expanded={needsToggle ? expanded : undefined}
    >
      {eventStatus && (
        <span
          className={[
            "absolute left-4 top-4 rounded-md px-2 py-0.5 text-xs font-semibold",
            eventStatus === "In progress"
              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
              : "",
            eventStatus === "Expired"
              ? "bg-slate-200 text-slate-700 border border-slate-300"
              : "",
          ].join(" ")}
        >
          {eventStatus}
        </span>
      )}

      <div className="card-body p-4">
        <div className="flex items-start gap-4">
          {/* Image column */}
          {eventData && (
            <div className="flex-none w-40 md:w-56 aspect-[4/3]">
              <img
                src={eventData.img || googleStreetView || `https://picsum.photos/seed/${id}/400/300`}
                alt={eventData.title || "Event"}
                className="h-full w-full rounded object-cover"
              />
              {eventData._row?.starts_at && (
                <div className="mt-1 text-xs text-base-content/50">
                  <strong>Starts:</strong>{" "}
                  {new Date(eventData._row.starts_at).toLocaleDateString()}
                </div>
              )}
              {eventData._row?.ends_at && (
                <div className="mt-1 text-xs text-base-content/50">
                  <strong>Ends:</strong>{" "}
                  {new Date(eventData._row.ends_at).toLocaleDateString()}
                </div>
              )}
            </div>
          )}

          {/* Details */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="card-title text-lg">{eventData?.title || `Event ${id}`}</h3>
                {/* Collapsible description */}
                {eventData?.description && <Description text={eventData.description} valid={!isExpired} />}
                {eventData?._row?.location_address && (
                  <p className="mt-1 text-xs text-base-content/50">
                    {eventData._row.location_address}
                  </p>
                )}
                {eventData?.position && (
                  <p className="mt-2 text-xs text-base-content/50">
                    📍 {eventData.position.lat.toFixed(4)}, {eventData.position.lng.toFixed(4)}
                  </p>
                )}
                <p className="mt-1 text-xs text-base-content/40">
                  Bookmarked: {new Date(bookmarkInfo.updatedAt).toLocaleDateString()}
                </p>
              </div>

              <button
                className={`btn btn-sm ${pending ? "btn-disabled" : "btn-ghost"} text-error`}
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
                      <path
                        d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 11-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z"
                      />
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
      const hay = [
        eventData.title,
        eventData.description,
        eventData?._row?.location_address,
      ]
        .map(normalize)
        .join(" ");

      return hay.includes(normalize(q));
    });

     const withFields = matches.map((row) => {
      const starts = row.eventData?._row?.starts_at
        ? new Date(row.eventData._row.starts_at)
        : null;
      const ends = row.eventData?._row?.ends_at
        ? new Date(row.eventData._row.ends_at)
        : null;
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
    () => bookmarkedEvents.filter(({ eventData }) => status(eventData) === "Expired").length,
    [bookmarkedEvents]
  );

  // Bulk remove expired
  const removeExpired = useCallback(async () => {
    if (!expiredCount) return;
    const ok = window.confirm(`Remove ${expiredCount} expired bookmark(s)?`);
    if (!ok) return;

    // fire-and-forget toggles; your hook can coalesce requests if needed
    const tasks = bookmarkedEvents
      .filter(({ eventData }) => status(eventData) === "Expired")
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
            <label className="input input-sm flex items-center gap-2 w-full" aria-label="Search bookmarks">
              <svg
                className="h-4 opacity-60"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
              >
                <g strokeLinejoin="round" strokeLinecap="round" strokeWidth="2" fill="none" stroke="currentColor">
                  <circle cx="11" cy="11" r="8"></circle>
                  <path d="m21 21-4.3-4.3"></path>
                </g>
              </svg>
              <input
                type="search"
                placeholder="Search title/description/address"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="min-w-0 flex-1 bg-transparent outline-none"
                aria-label="Search bookmarks"
              />
              {q && (
                <button
                  className="text-xs opacity-60 hover:opacity-100"
                  onClick={() => setQ("")}
                  type="button"
                >
                  Clear
                </button>
              )}
            </label>

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
        <div className="mt-4 grid gap-4">
          {filteredSorted.length === 0 ? (
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
              <span>{
                q ? "No bookmarked events match your search." : "No bookmarked events yet."
              }</span>
            </div>
          ) : (
            filteredSorted.map(({ id, eventData, bookmarkInfo }) =>
              <BookmarkListItem
                key={id}
                id={id}
                eventData={eventData}
                bookmarkInfo={bookmarkInfo}
                toggle={toggle}
                pending={isPending(id)}
              />
            )
          )}
        </div>
      </div>
    </div>
  );
}
