import React, { useState, useEffect } from "react";
import { createEvent as apiCreateEvent, updateEvent as apiUpdateEvent } from "../services/eventsService";

export default function EventForm({ initialData = {}, onSaved, onCancel, onOptimistic, onRollback }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    address: "",
    latitude: "",
    longitude: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (initialData) {
      setForm({
        address: initialData.address || "",
        latitude: initialData.latitude ?? initialData.lat ?? "",
        longitude: initialData.longitude ?? initialData.lng ?? "",
        title: initialData.title || "",
        description: initialData.description || "",
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
      setError("Please fill in title, description and coordinates.");
      return;
    }
    setError("");
    (async () => {
      setLoading(true);
      try {
      const payload = { title: form.title, description: form.description, latitude: Number(form.latitude), longitude: Number(form.longitude) };
        if (initialData && initialData.id) {
          // optimistic update: inform parent to update UI immediately
          const optimistic = {
            id: initialData.id,
            title: payload.title,
            description: payload.description,
            latitude: payload.latitude,
            longitude: payload.longitude,
          };
          try {
            onOptimistic?.(optimistic);
          } catch (err) {
            // ignore optimistic hook errors
            console.warn('onOptimistic hook failed', err);
          }

          // perform the network update
          const updated = await apiUpdateEvent(initialData.id, payload);
          onSaved(updated);
        } else {
          const created = await apiCreateEvent(payload);
          onSaved(created);
        }
      } catch (err) {
        console.error('Failed to save event', err);
        setError('Failed to save event');
        // notify parent to rollback optimistic change for edits
        try {
          onRollback?.(initialData);
        } catch (e) {
          console.warn('onRollback hook failed', e);
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
               name="address"
               value={form.address}
               readOnly
               disabled
               className="input input-bordered w-full bg-base-200"
               aria-readonly="true"
             />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">
              <span className="label-text">Latitude</span>
            </label>
               <input
                 type="text"
                 name="latitude"
                 value={form.latitude}
                 readOnly
                 disabled
                 className="input input-bordered w-full bg-base-200"
                 aria-readonly="true"
               />
          </div>
          <div>
            <label className="label">
              <span className="label-text">Longitude</span>
            </label>
               <input
                 type="text"
                 name="longitude"
                 value={form.longitude}
                 readOnly
                 disabled
                 className="input input-bordered w-full bg-base-200"
                 aria-readonly="true"
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
            {loading ? (initialData?.id ? 'Saving...' : 'Creating...') : (initialData?.id ? 'Save' : 'Create Event')}
          </button>
        </div>
      </form>
    </div>
  );
}
