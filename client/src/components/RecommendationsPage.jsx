import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { useBookmarks } from "../hooks";
import EventArtwork from "./EventArtwork";
import {eventImage,eventTime,nextStart} from "../utils/event";
import PageLayout from "./PageLayout";
import { interestApi } from "../services/interestApi";

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
    <PageLayout title="For you" intro={result?.personalized?"Suggestions based on the categories you have saved. Each event explains why it appears.":"Explore upcoming events. Turn on personalization for suggestions based on your saved categories."} actions={<Link to="/settings" className="btn btn-outline">Recommendation settings</Link>}>
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
            <p className="text-sm muted">
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
                <article key={event.id} className="content-card recommendation-card">
                  <EventArtwork src={eventImage(event)?.url} category={event.category} title={event.title} className="aspect-[16/10] w-full"/>
                  <div className="card-body gap-3 p-5">
                    <span className="badge badge-outline text-xs">{event.category || "Other"}</span>
                    <h2 className="card-title text-lg"><Link to={`/?event=${event.id}`}>{event.title}</Link></h2>
                    <p className="text-sm font-medium">{eventTime(nextStart(event))}</p>
                    <p className="text-sm muted">
                      {event.location_name || event.location_address || "Toronto"}
                      {event.location_name && event.location_address
                        ? ` · ${event.location_address}`
                        : ""}
                    </p>
                    <p className="recommendation-reason">
                      <span className="font-medium">Why this event: </span>
                      {event.reason}
                    </p>
                    <button
                      className={`btn btn-outline mt-auto ${isBookmarked(event.id) ? "is-saved" : ""}`}
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
    </PageLayout>
  );
}
