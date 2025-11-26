import React, { useState, useEffect, useMemo } from "react";
import { fetchUserComments, removeComment } from "../../services/commentsService";
import { getEventStatus, normalize } from "../../utils/date";
import EventStatusBadge from "../../components/EventStatusBadge";
import EventImage from "../../components/EventImage";
import SearchInput from "../../components/SearchInput";
import LoadingSpinner from "../../components/LoadingSpinner";
import Description from "../../components/Description";
import EmptyState from "../../components/EmptyState";
import { useNotifications } from "../../contexts/NotificationContext.jsx";

const CommentListItem = ({ item, onDelete, pending }) => {
  const eventStatus = getEventStatus(item.event);
  const isExpired = eventStatus === "Expired";

  const handleDelete = async () => {
    if (!confirm("Delete this comment?")) return;
    await onDelete(item.event.id, item.comment.id);
  };

  return (
    <div
      className={[
        "card bg-base-200 relative shadow-sm transition",
        isExpired ? "opacity-60 grayscale" : "",
      ].join(" ")}
    >
      <EventStatusBadge status={eventStatus} />

      <div className="card-body p-4">
        <div className="flex items-start gap-4">
          <EventImage event={item.event} fallbackSeed={item.event?.id} />

          {/* Comment Details */}
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="card-title text-lg">
                  {item.event?.title || `Event ${item.event?.id || "Unknown"}`}
                </h3>

                {item.comment?.text && <Description text={item.comment.text} />}

                {item.event?.locationAddress && (
                  <p className="text-base-content/50 mt-1 text-xs">{item.event.locationAddress}</p>
                )}

                <p className="text-base-content/40 mt-1 text-xs">
                  Commented: {new Date(item.comment.createdAt).toLocaleDateString()}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                <button
                  className={`btn btn-sm ${pending ? "btn-disabled" : "btn-ghost"} text-error`}
                  onClick={handleDelete}
                  disabled={pending}
                  title="Delete comment"
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
                      <path
                        fillRule="evenodd"
                        d="M16.5 4.478v.227a48.816 48.816 0 013.878.512.75.75 0 11-.256 1.478l-.209-.035-1.005 13.07a3 3 0 01-2.991 2.77H8.084a3 3 0 01-2.991-2.77L4.087 6.66l-.209.035a.75.75 0 01-.256-1.478A48.567 48.567 0 017.5 4.705v-.227c0-1.564 1.213-2.9 2.816-2.951a52.662 52.662 0 013.369 0c1.603.051 2.815 1.387 2.815 2.951zm-6.136-1.452a51.196 51.196 0 013.273 0C14.39 3.05 15 3.684 15 4.478v.113a49.488 49.488 0 00-6 0v-.113c0-.794.609-1.428 1.364-1.452zm-.355 5.945a.75.75 0 10-1.5.058l.347 9a.75.75 0 101.499-.058l-.346-9zm5.48.058a.75.75 0 10-1.498-.058l-.347 9a.75.75 0 001.5.058l.345-9z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function UserComments() {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pendingOps, setPendingOps] = useState(new Set());
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState("created-desc");
  const { push } = useNotifications();

  useEffect(() => {
    loadComments();
  }, []);

  const loadComments = async () => {
    setLoading(true);
    try {
      const data = await fetchUserComments();
      setComments(data);
    } catch (err) {
      push({ type: "error", message: "Failed to load comments", autoCloseMs: 5000 });

      console.error("Failed to load comments:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (eventId, commentId) => {
    const key = `delete-${commentId}`;
    setPendingOps((prev) => new Set(prev).add(key));
    try {
      await removeComment(eventId, commentId);
      setComments((prev) => prev.filter((item) => item.comment.id !== commentId));
      push({ type: "success", message: "Comment deleted", autoCloseMs: 3000 });
    } catch (err) {
      console.error("Failed to delete comment:", err);
      push({ type: "error", message: "Failed to delete comment", autoCloseMs: 5000 });
    } finally {
      setPendingOps((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  };

  const filteredSorted = useMemo(() => {
    const matches = comments.filter((item) => {
      if (!q) return true;
      const hay = [item.comment.text, item.event?.title, item.event?.locationAddress]
        .map(normalize)
        .join(" ");
      return hay.includes(normalize(q));
    });

    const sorted = [...matches];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "title-asc":
          return normalize(a.event?.title).localeCompare(normalize(b.event?.title));
        case "title-desc":
          return normalize(b.event?.title).localeCompare(normalize(a.event?.title));
        case "created-asc":
          return new Date(a.comment.createdAt) - new Date(b.comment.createdAt);
        case "created-desc":
        default:
          return new Date(b.comment.createdAt) - new Date(a.comment.createdAt);
      }
    });

    return sorted;
  }, [comments, q, sortKey]);

  const expiredCount = useMemo(
    () => comments.filter((item) => getEventStatus(item) === "Expired").length,
    [comments]
  );

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="card bg-base-100">
      <div className="card-body">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="card-title">My Comments</h2>
            <p className="text-sm opacity-70">
              {comments.length} total · {expiredCount} on expired events
            </p>
          </div>

          {/* Toolbar */}
          <div className="flex w-full flex-col gap-2 md:w-auto md:flex-row md:items-center">
            <SearchInput value={q} onChange={setQ} ariaLabel="Search comments" />

            {/* Sort */}
            <select
              className="select select-sm w-full"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value)}
              title="Sort by"
            >
              <option value="created-desc">Recently commented</option>
              <option value="created-asc">Oldest first</option>
              <option value="title-asc">Event Title A–Z</option>
              <option value="title-desc">Event Title Z–A</option>
            </select>
          </div>
        </div>

        {/* Display comments */}
        <div className="mt-4 grid gap-4">
          {filteredSorted.length === 0 ? (
            <EmptyState message={q ? "No comments match your search." : "No comments yet."} />
          ) : (
            filteredSorted.map((item) => (
              <CommentListItem
                key={item.comment.id}
                item={item}
                onDelete={handleDelete}
                pending={pendingOps.has(`delete-${item.comment.id}`)}
              />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
