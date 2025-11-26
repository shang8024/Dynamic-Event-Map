import React, { useEffect, useState, useCallback } from "react";
import { fetchComments, addComment, removeComment } from "../services/commentsService";
import socket from "../services/socket";
import { useAuth } from "../contexts/AuthContext.jsx";
import { useNotifications } from "../contexts/NotificationContext.jsx";

export default function EventComments({ eventId }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const { user } = useAuth();
  const { push } = useNotifications();

  // ---------------------------
  // Load Comments
  // ---------------------------
  const loadComments = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const list = await fetchComments(eventId);
      setComments(list || []);
    } catch (err) {
      console.warn("fetch comments failed", err);
      setError("Failed to load comments");
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  // ---------------------------
  // Add Comment
  // ---------------------------
  const handleAdd = useCallback(
    async (e) => {
      e?.preventDefault();
      if (!user) return setError("You must be logged in to post comments");

      const trimmed = text.trim();
      if (!trimmed) return setError("Please enter a comment");

      setLoading(true);
      setError("");

      try {
        const created = await addComment(eventId, trimmed);
        setComments((prev) => [created, ...prev.filter((c) => c.id !== created.id)]);
        setText("");
        push({ type: "success", message: "Comment posted successfully", autoCloseMs: 2000 });
      } catch (err) {
        console.warn("post failed", err);
        push({
          type: "error",
          message: err.message || "Failed to post comment",
          autoCloseMs: 5000,
        });
      } finally {
        setLoading(false);
      }
    },
    [user, text, eventId, push]
  );

  // ---------------------------
  // Delete Comment
  // ---------------------------
  const handleDelete = useCallback(
    async (id) => {
      setLoading(true);
      try {
        await removeComment(eventId, id);
        setComments((prev) => prev.filter((c) => c.id !== id));
        push({ type: "success", message: "Comment deleted successfully", autoCloseMs: 2000 });
      } catch (err) {
        console.warn("delete failed", err);
        push({
          type: "error",
          message: err.message || "Failed to delete comment",
          autoCloseMs: 5000,
        });
      } finally {
        setLoading(false);
      }
    },
    [eventId, push]
  );

  // ---------------------------
  // Real-time Handlers (room-based)
  // ---------------------------
  const onCommentCreated = useCallback(
    (payload) => {
      if (Number(payload.eventId) !== Number(eventId)) return;
      setComments((prev) => [payload, ...prev.filter((c) => String(c.id) !== String(payload.id))]);
    },
    [eventId]
  );

  const onCommentDeleted = useCallback(
    (payload) => {
      if (Number(payload.eventId) !== Number(eventId)) return;
      setComments((prev) => prev.filter((c) => String(c.id) !== String(payload.id)));
    },
    [eventId]
  );

  // ---------------------------
  // Effects
  // ---------------------------
  useEffect(() => {
    if (!eventId) return;

    loadComments();

    // Subscribe to room-specific events
    socket.on(`comment:created:${eventId}`, onCommentCreated);
    socket.on(`comment:deleted:${eventId}`, onCommentDeleted);

    return () => {
      socket.off(`comment:created:${eventId}`, onCommentCreated);
      socket.off(`comment:deleted:${eventId}`, onCommentDeleted);
    };
  }, [eventId, loadComments, onCommentCreated, onCommentDeleted]);

  // ---------------------------
  // Render
  // ---------------------------
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Scrollable comments list */}
      <div className="flex-1 overflow-y-auto p-2 pb-[100px]">
        <ul className="flex w-full flex-col gap-2">
          {comments.length === 0 && (
            <li className="text-base-content/60 text-sm">No comments yet.</li>
          )}
          {comments.map((c) => (
            <li key={c.id}>
              <div className="card card-dash bg-base-100 w-full">
                <div className="card-body p-3">
                  <div className="text-sm font-semibold">{c.user?.name || "Anonymous"}</div>
                  <p className="mt-1 text-sm break-words whitespace-pre-wrap">{c.text}</p>
                  <div className="card-actions w-full items-center justify-between">
                    <div className="text-base-content/50 text-xs">
                      {new Date(c.createdAt).toLocaleString()}
                    </div>
                    {user && String(user.id) === String(c.user?.id) && (
                      <button
                        className="btn btn-ghost btn-xs p-1"
                        onClick={() => handleDelete(c.id)}
                        disabled={loading}
                        title="Delete comment"
                        aria-label="Delete comment"
                      >
                        <svg width="14" height="14" viewBox="0 0 16 16">
                          <path
                            fill="currentColor"
                            d="m4.818 4.111l-.707.707a.5.5 0 0 0 0 .707L6.586 8L4.11 10.475a.5.5 0 0 0 0 .707l.707.707a.5.5 0 0 0 .707 0L8 9.414l2.475 2.475a.5.5 0 0 0 .707 0l.707-.707a.5.5 0 0 0 0-.707L9.414 8l2.475-2.475a.5.5 0 0 0 0-.707l-.707-.707a.5.5 0 0 0-.707 0L8 6.586L5.525 4.11a.5.5 0 0 0-.707 0"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {/* Fixed bottom form */}
      <div className="bg-base-200 fixed bottom-0 left-0 z-50 w-full p-4">
        <form onSubmit={handleAdd} className="flex flex-row gap-3">
          {error && <div className="text-error mb-1 text-xs">{error}</div>}

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              user ? `Comment as ${user.displayName || user.email}...` : "Please login to comment"
            }
            className="textarea textarea-bordered w-4/5 resize-none"
            disabled={!user}
          />

          <button
            type="submit"
            className="btn btn-neutral h-auto shrink-0"
            disabled={loading || !user}
          >
            {loading ? "Posting…" : "Post"}
          </button>
        </form>
      </div>
    </div>
  );
}
