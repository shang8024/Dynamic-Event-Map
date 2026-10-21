import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { interestApi } from "../services/interestApi";

export default function UnsubscribePage() {
  const [search, setSearch] = useSearchParams();
  const token = search.get("token");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [scope, setScope] = useState("");
  const confirm = async () => {
    setBusy(true);
    setError("");
    try {
      const result = await interestApi.unsubscribe(token);
      setScope(result.scope);
      setSearch({}, { replace: true });
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="mx-auto max-w-lg py-10">
      <h1 className="text-2xl font-semibold">Email preferences</h1>
      {scope ? (
        <p role="status" className="mt-5">
          You are unsubscribed from{" "}
          {scope === "marketing"
            ? "newsletters and marketing emails"
            : scope === "reminders"
              ? "saved-event reminders"
              : "all event reminder and marketing emails"}
          . Your account and bookmarks are unchanged.
        </p>
      ) : token ? (
        <>
          <p className="mt-4">
            Confirm below to stop the type of email associated with this link. You do not need to
            sign in.
          </p>
          <button className="btn btn-primary mt-5" disabled={busy} onClick={confirm}>
            {busy ? "Updating…" : "Confirm unsubscribe"}
          </button>
        </>
      ) : (
        <p className="mt-5">
          This page needs the unsubscribe link from your email. You can also sign in to update your
          preferences.
        </p>
      )}
      {error && (
        <p role="alert" className="text-error mt-4">
          {error}
        </p>
      )}
      <Link to="/settings" className="link mt-6 inline-block">
        Manage all preferences
      </Link>
    </main>
  );
}
