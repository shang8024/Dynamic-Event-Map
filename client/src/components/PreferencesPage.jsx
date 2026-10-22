import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { interestApi } from "../services/interestApi";
import PageLayout from "./PageLayout";
import {preferencePayload} from '../services/interestClient';
import useUnsavedChanges from '../hooks/useUnsavedChanges';
import NotificationPreferences from './NotificationPreferences';

export default function PreferencesPage() {
  const { user } = useAuth();
  const [preferences, setPreferences] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [baseline,setBaseline]=useState(null);
  const saveRequest=useRef(null),navigate=useNavigate();
  const dirty=Boolean(preferences&&baseline&&JSON.stringify(preferencePayload(preferences))!==JSON.stringify(preferencePayload(baseline)));
  const {allowNavigation}=useUnsavedChanges({dirty,busy:saving,title:'Leave without saving your preferences?',description:'Your email and privacy choices have not been saved. Keep editing to save them before leaving.'});

  useEffect(() => {
    const controller = new AbortController();
    setError("");
    setPreferences(null);
    setBaseline(null);setSaved(false);setDelivery(null);setSaving(false);
    interestApi
      .getPreferences(controller.signal)
      .then((result) => {
        if (controller.signal.aborted) return;
        setPreferences(result.preferences);
        setBaseline(result.preferences);
        setDelivery(result.delivery);
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => {controller.abort();saveRequest.current?.abort();};
  }, [user.id, attempt]);

  const change = (key, value) => {
    setPreferences((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };
  const save = async (event,explore=false) => {
    event?.preventDefault();
    if(saving) return;
    if(!dirty&&explore) {allowNavigation(()=>navigate('/recommendations'));return;}
    const controller=new AbortController();saveRequest.current=controller;
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const result = await interestApi.savePreferences(preferences,controller.signal);
      if(controller.signal.aborted) return;
      setPreferences(result.preferences);
      setBaseline(result.preferences);
      setDelivery(result.delivery);
      setSaved(true);
      if(explore) allowNavigation(()=>navigate('/recommendations'));
    } catch (error) {
      if(!controller.signal.aborted) setError(error.message);
    } finally {
      if(!controller.signal.aborted) setSaving(false);
    }
  };

  return (
    <PageLayout title="Settings" narrow intro="Choose how notifications appear, what you receive and how we suggest events.">
      <NotificationPreferences/>
      <h2 className="text-lg font-semibold">Email & privacy</h2>
      <p className="text-sm muted">Saving an event does not subscribe you to marketing.</p>
      {error && (
        <div role="alert" className="alert alert-error mt-5">
          <span>{error}</span>
          {!preferences && (
            <button className="btn btn-sm" onClick={() => setAttempt((value) => value + 1)}>
              Try again
            </button>
          )}
        </div>
      )}
      {!preferences && !error && (
        <p role="status" className="py-8">
          Loading your preferences…
        </p>
      )}
      {preferences && (
        <form onSubmit={save} className="mt-6 space-y-5">
          <p className="text-sm">
            Email destination: <strong className="break-all">{user.email}</strong>
          </p>
          {delivery?.enabled !== true && (
            <div role="status" className="alert">
              <span>
                Your choices can be saved now. Email delivery is not active yet; reminders and
                newsletters will not be sent until it is enabled.
              </span>
            </div>
          )}
          <fieldset disabled={saving} className="space-y-5">
            <legend className="sr-only">Email and personalization preferences</legend>
            <section className="content-card preference-card">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary mt-1"
                  checked={preferences.reminders_enabled === true}
                  onChange={(event) => change("reminders_enabled", event.target.checked)}
                  aria-describedby="reminder-help"
                />
                <span>
                  <span className="font-semibold">Remind me about saved events</span>
                  <span id="reminder-help" className="mt-1 block text-sm muted">
                    Email me before an upcoming event I have bookmarked. Remove its bookmark to stop
                    reminders for that event.
                  </span>
                </span>
              </label>
              <label className="mt-4 block text-sm font-medium" htmlFor="reminder-lead">
                Send my reminder
              </label>
              <select
                id="reminder-lead"
                className="select mt-2 w-full"
                disabled={!preferences.reminders_enabled || saving}
                value={preferences.reminder_lead_hours}
                onChange={(event) => change("reminder_lead_hours", Number(event.target.value))}
              >
                <option value={24}>24 hours before the event</option>
                <option value={1}>1 hour before the event</option>
              </select>
              <p className="mt-2 text-xs muted">
                Event schedules use Toronto time (America/Toronto). Last-minute event changes may
                affect a reminder.
              </p>
            </section>
            <section className="content-card preference-card">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary mt-1"
                  checked={preferences.marketing_enabled === true}
                  onChange={(event) => change("marketing_enabled", event.target.checked)}
                  aria-describedby="marketing-help"
                />
                <span>
                  <span className="font-semibold">Send me newsletters and marketing emails</span>
                  <span id="marketing-help" className="mt-1 block text-sm muted">
                    I would like to receive event roundups and promotional updates from Dynamic
                    Events Map. This is optional and separate from saved-event reminders.
                  </span>
                </span>
              </label>
            </section>
            <section className="content-card preference-card">
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="checkbox checkbox-primary mt-1"
                  checked={preferences.personalization_enabled === true}
                  onChange={(event) => change("personalization_enabled", event.target.checked)}
                  aria-describedby="personalization-help"
                />
                <span>
                  <span className="font-semibold">Personalize my event recommendations</span>
                  <span id="personalization-help" className="mt-1 block text-sm muted">
                    Use the categories of events I have bookmarked to suggest other upcoming events.
                    When this is off, show upcoming events without using my interests. My bookmarks
                    stay saved.
                  </span>
                </span>
              </label>
              <button type="button" className="link mt-3 inline-block min-h-11 text-sm" disabled={saving} onClick={()=>save(null,true)}>
                {dirty?'Save and explore recommendations':'Explore recommendations'}
              </button>
            </section>
            <p className="text-sm muted">
              You can turn either email option off here at any time. Emails include an unsubscribe
              link that works without signing in. We use your verified account email for delivery
              and your saved categories only when personalization is enabled.
            </p>
            <p role="status" className="text-sm muted">{dirty?'You have unsaved changes.':'Your current choices are saved.'}</p>
            <button type="submit" className="btn btn-primary" disabled={saving||!dirty}>
              {saving ? "Saving…" : "Save preferences"}
            </button>
          </fieldset>
          {saved && (
            <p role="status" className="text-success">
              Your preferences are saved.
              {delivery?.enabled !== true ? " Email delivery is still pending." : ""}
            </p>
          )}
        </form>
      )}
    </PageLayout>
  );
}
