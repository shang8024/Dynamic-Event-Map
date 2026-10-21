import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useBookmarks } from "../hooks";
import EventArtwork from "./EventArtwork";
import {eventImage} from "../utils/event";
import { interestApi } from "../services/interestApi";

function eventTime(value) {
  if (!value || Number.isNaN(new Date(value).getTime())) return "Check the event schedule";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Toronto",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function RecommendationsPage() {
  const { user } = useAuth();
  const { toggle, isBookmarked, isPending } = useBookmarks();
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setResult(null);
    setError("");
    interestApi
      .getRecommendations(controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setResult(result);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [user.id, attempt]);

  return (
    <main className="mx-auto max-w-5xl pt-3 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Discover your next event</h1>
          <p className="mt-2 max-w-xl text-sm opacity-75">
            {result?.personalized
              ? "Suggestions based on the categories you have saved. Each event explains why it appears."
              : "Upcoming events in Toronto. Turn on personalization in settings for suggestions based on your saved categories."}
          </p>
        </div>
        <Link to="/settings" className="btn btn-outline btn-sm">
          Recommendation settings
        </Link>
      </div>
      {error && (
        <div role="alert" className="alert alert-error mt-6">
          <span>{error}</span>
          <button className="btn btn-sm" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </div>
      )}
      {!result && !error && (
        <p role="status" className="py-8">
          Finding upcoming events…
        </p>
      )}
      {result && (
        <>
          <div className="mt-5 flex items-center justify-between gap-3">
            <p className="text-sm opacity-70">
              Times shown in Toronto time. Saved and ended events are excluded when this list
              refreshes.
            </p>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Refresh
            </button>
          </div>
          {result.events.length === 0 ? (
            <div className="rounded-box bg-base-200 mt-6 p-8">
              <h2 className="font-semibold">No new recommendations right now</h2>
              <p className="mt-2 text-sm">Explore the map or check back as new events are added.</p>
              <Link to="/" className="btn btn-primary btn-sm mt-4">
                Explore the map
              </Link>
            </div>
          ) : (
            <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {result.events.map((event) => (
                <article key={event.id} className="card bg-base-200 overflow-hidden shadow-sm">
                  <EventArtwork src={eventImage(event)?.url} category={event.category} title={event.title} className="aspect-[16/10] w-full"/>
                  <div className="card-body gap-3 p-5">
                    <span className="badge badge-outline text-xs">{event.category || "Other"}</span>
                    <h2 className="card-title text-lg">{event.title}</h2>
                    <p className="text-sm font-medium">{eventTime(event.starts_at)}</p>
                    <p className="text-sm opacity-75">
                      {event.location_name || event.location_address || "Toronto"}
                      {event.location_name && event.location_address
                        ? ` · ${event.location_address}`
                        : ""}
                    </p>
                    <p className="bg-base-100 rounded-md p-3 text-sm">
                      <span className="font-medium">Why this event: </span>
                      {event.reason}
                    </p>
                    <button
                      className={`btn btn-sm mt-auto ${isBookmarked(event.id) ? "btn-outline" : "btn-primary"}`}
                      disabled={isPending(event.id)}
                      aria-pressed={isBookmarked(event.id)}
                      onClick={() => toggle(event.id, undefined, event)}
                    >
                      {isPending(event.id)
                        ? "Updating…"
                        : isBookmarked(event.id)
                          ? "Saved · remove bookmark"
                          : "Save event"}
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
