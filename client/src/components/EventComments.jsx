import React, { useEffect, useState } from "react";
import { fetchComments, addComment, removeComment } from "../services/commentsService";
import socket from "../services/socket";
import { useAuth } from "../contexts/AuthContext.jsx";

export default function EventComments({ eventId }) {
  const [comments, setComments] = useState([]);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { user } = useAuth();

  const load = async () => {
    setLoading(true);
    try {
      const list = await fetchComments(eventId);
      setComments(list);
    } catch (err) {
      console.warn("fetch comments failed", err);
      setError("Failed to load comments");
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e) => {
    if (!user) {
      setError("You must be logged in to post comments");
      return;
    }
    e?.preventDefault();
    const trimmed = (text || "").trim();
    if (!trimmed) {
      setError("Please enter a comment");
      return;
    }
    setError("");
    setLoading(true);
    try {
      const created = await addComment(eventId, trimmed);
      setComments((prev) => {
        if (prev.some((c) => String(c.id) === String(created.id))) return prev;
        return [created, ...prev];
      });
      setText("");
    } catch (err) {
      console.warn("post failed", err);
      setError(err.message || "Failed to post comment");
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    setLoading(true);
    try {
      await removeComment(eventId, id);
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      console.warn("delete failed", err);
      setError(err.message || "Failed to delete comment");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    // only load when mounted and eventId exists
    if (!eventId) return;
    (async () => {
      if (!mounted) return;
      await load();
    })();

    // realtime listeners for comments related to this event
    function onCommentCreated(payload) {
      try {
        if (Number(payload.eventId) !== Number(eventId)) return;
        setComments((prev) => {
          if (prev.some((c) => String(c.id) === String(payload.id))) return prev;
          return [payload, ...prev];
        });
      } catch {
        // ignore
      }
    }

    function onCommentDeleted(payload) {
      try {
        if (Number(payload.eventId) !== Number(eventId)) return;
        setComments((prev) => prev.filter((c) => String(c.id) !== String(payload.id)));
      } catch {
        // ignore
      }
    }

    socket.on("comment:created", onCommentCreated);
    socket.on("comment:deleted", onCommentDeleted);

    return () => {
      mounted = false;
      socket.off("comment:created", onCommentCreated);
      socket.off("comment:deleted", onCommentDeleted);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventId]);

  return (
    <div className="mt-3">
      <form onSubmit={handleAdd} className="mb-2">
        {error && <div className="text-error mb-2 text-xs">{error}</div>}
        <div className="flex items-stretch gap-2">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              user ? `Comment as ${user.displayName || user.email}...` : "Please login to comment"
            }
            className="textarea textarea-bordered min-h-[72px] flex-1"
            disabled={!user}
          />

          <div className="flex-shrink-0">
            <button
              type="submit"
              className="btn btn-neutral h-full"
              disabled={loading || !user}
              title={!user ? "Please login to post comment" : ""}
            >
              {loading ? "Posting…" : "Post"}
            </button>
          </div>
        </div>
      </form>

      <div className="divider mt-1 mb-1"></div>

      <ul className="max-h-80 space-y-2 overflow-x-hidden overflow-y-auto">
        {comments.length === 0 && (
          <li className="text-base-content/60 text-sm">No comments yet.</li>
        )}
        {comments.map((c) => (
          <li key={c.id}>
            <div className="card card-dash bg-base-100 w-full">
              <div className="card-body p-3">
                <div className="text-sm font-semibold">{c.user?.name || "Anonymous"}</div>
                <p className="mt-1 text-sm break-words whitespace-pre-wrap">{c.text}</p>
                <div className="card-actions mt-2 w-full items-center justify-between">
                  <div className="text-base-content/50 text-xs">
                    {new Date(c.createdAt).toLocaleString()}
                  </div>
                  <div>
                    {user && String(user.id) === String(c.user?.id) && (
                      <button
                        className="btn btn-ghost btn-xs p-1"
                        onClick={() => handleDelete(c.id)}
                        disabled={loading}
                        title="Delete comment"
                        aria-label="Delete comment"
                      >
                        <svg
                          width="14"
                          height="14"
                          xmlns="http://www.w3.org/2000/svg"
                          viewBox="0 0 16 16"
                        >
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
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
