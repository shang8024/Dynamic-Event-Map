import React, { useState, useEffect } from "react";
import {
  createEvent as apiCreateEvent,
  updateEvent as apiUpdateEvent,
} from "../services/eventsService";
import { useNotifications } from "../contexts/NotificationContext.jsx";

export default function EventForm({
  initialData = {},
  onSaved,
  onCancel,
  onOptimistic,
  onRollback,
}) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    location_address: "",
    latitude: "",
    longitude: "",
    category: "",
    starts_at: "",
    ends_at: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { push } = useNotifications();

  function formatDateTimeLocal(date) {
    if (!date) return "";
    const d = new Date(date);
    const pad = (n) => String(n).padStart(2, "0");
    const year = d.getFullYear();
    const month = pad(d.getMonth() + 1);
    const day = pad(d.getDate());
    const hours = pad(d.getHours());
    const minutes = pad(d.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  useEffect(() => {
    if (initialData) {
      setForm({
        location_address: initialData.location_address || "",
        latitude: initialData.latitude ?? initialData.lat ?? "",
        longitude: initialData.longitude ?? initialData.lng ?? "",
        title: initialData.title || "",
        category: initialData.category || "",
        description: initialData.description || "",
        starts_at: formatDateTimeLocal(initialData.starts_at),
        ends_at: formatDateTimeLocal(initialData.ends_at),
      });
    }
  }, [initialData]);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const validateForm = () => {
    return form.title && form.description && form.latitude && form.longitude;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) {
      setError("Please fill in title, description, start time and end time.");
      return;
    }
    setError("");
    (async () => {
      setLoading(true);
      try {
        const payload = {
          title: form.title,
          description: form.description,
          category: form.category || "Other",
          latitude: Number(form.latitude),
          longitude: Number(form.longitude),
          location_address: form.location_address,
          starts_at: new Date(form.starts_at).toISOString().slice(0, 16),
          ends_at: new Date(form.ends_at).toISOString().slice(0, 16),
        };
        if (initialData && initialData.id) {
          // optimistic update: inform parent to update UI immediately
          const optimistic = {
            id: initialData.id,
            title: payload.title,
            description: payload.description,
            latitude: payload.latitude,
            longitude: payload.longitude,
            location_address: payload.location_address,
            starts_at: payload.starts_at,
            ends_at: payload.ends_at,
          };
          try {
            onOptimistic?.(optimistic);
          } catch (err) {
            // ignore optimistic hook errors
            console.warn("onOptimistic hook failed", err);
          }

          // perform the network update with full payload including address/coords
          const updated = await apiUpdateEvent(initialData.id, {
            title: payload.title,
            description: payload.description,
            category: payload.category,
            starts_at: payload.starts_at,
            ends_at: payload.ends_at,
          });
          onSaved(updated);
          push({ type: "success", message: "Event updated successfully!", autoCloseMs: 3000 });
        } else {
          const created = await apiCreateEvent(payload);
          onSaved(created);
          push({ type: "success", message: "Event created successfully!", autoCloseMs: 3000 });
        }
      } catch (err) {
        console.error("Failed to save event", err);
        setError(err.message || "Failed to save event");
        // notify parent to rollback optimistic change for edits
        try {
          onRollback?.(initialData);
          push({
            type: "error",
            message: "Failed to save event. Changes have been reverted.",
            autoCloseMs: 5000,
          });
        } catch (e) {
          console.warn("onRollback hook failed", e);
          push({
            type: "error",
            message: "Failed to save event. Rollback failed.",
            autoCloseMs: 5000,
          });
        }
      } finally {
        setLoading(false);
      }
    })();
  };

  return (
    <div className="card bg-base-100 shadow">
      <form onSubmit={handleSubmit} className="card-body space-y-3">
        <h3 className="card-title">Create Event</h3>

        <div>
          <label className="label">
            <span className="label-text">Address</span>
          </label>
          <input
            type="text"
            name="location_address"
            value={form.location_address}
            readOnly
            disabled
            className="input input-bordered bg-base-200 w-full"
            aria-readonly="true"
          />
        </div>

        {/* Hidden inputs to store values */}
        <input type="hidden" name="latitude" value={form.latitude} />
        <input type="hidden" name="longitude" value={form.longitude} />

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">
              <span className="label-text">Start</span>
            </label>
            <input
              type="datetime-local"
              name="starts_at"
              value={form.starts_at}
              onChange={handleChange}
              className="input input-bordered w-full"
            />
          </div>
          <div>
            <label className="label">
              <span className="label-text">End</span>
            </label>
            <input
              type="datetime-local"
              name="ends_at"
              value={form.ends_at}
              onChange={handleChange}
              className="input input-bordered w-full"
            />
          </div>
        </div>

        <div>
          <label className="label">
            <span className="label-text">Title</span>
          </label>
          <input
            type="text"
            name="title"
            placeholder="Event Title"
            value={form.title}
            onChange={handleChange}
            className="input input-bordered w-full"
          />
        </div>

        <div>
          <label className="label">
            <span className="label-text">Category</span>
          </label>
          <select
            name="category"
            value={form.category}
            onChange={handleChange}
            className="select select-bordered w-full"
          >
            <option value="">Select category</option>
            <option>Arts & Culture</option>
            <option>Entertainment & Leisure</option>
            <option>Education & Workshops</option>
            <option>Sports & Fitness</option>
            <option>Food & Drink</option>
            <option>Business & Networking</option>
            <option>Community & Social</option>
            <option>Family & Kids</option>
            <option>Technology & Innovation</option>
            <option>Other</option>
          </select>
        </div>

        <div>
          <label className="label">
            <span className="label-text">Description</span>
          </label>
          <textarea
            name="description"
            placeholder="Event Description"
            value={form.description}
            onChange={handleChange}
            className="textarea textarea-bordered w-full"
          />
        </div>

        {error && <div className="text-error text-sm">{error}</div>}

        <div className="flex items-center justify-end gap-2">
          <button type="button" className="btn" onClick={onCancel} disabled={loading}>
            Cancel
          </button>
          <button type="submit" className="btn btn-neutral" disabled={loading}>
            {loading
              ? initialData?.id
                ? "Saving..."
                : "Creating..."
              : initialData?.id
                ? "Save"
                : "Create Event"}
          </button>
        </div>
      </form>
    </div>
  );
}
