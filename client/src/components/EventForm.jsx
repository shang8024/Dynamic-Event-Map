import React, { useState, useEffect } from "react";

export default function EventForm({ initialData = {}, onSaved, onCancel }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    address: "",
    lat: "",
    lng: "",
  });
  const [error, setError] = useState("");

  useEffect(() => {
    if (initialData) {
      setForm({
        address: initialData.address || "",
        lat: initialData.lat || "",
        lng: initialData.lng || "",
        title: initialData.title || "",
        description: initialData.description || "",
      });
    }
  }, [initialData]);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const validateForm = () => {
    return form.title && form.description && form.lat && form.lng;
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!validateForm()) {
      setError("Please fill in title, description and coordinates.");
      return;
    }
    setError("");
    onSaved({ id: Date.now(), ...form, lat: Number(form.lat), lng: Number(form.lng) });
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
                 name="lat"
                 value={form.lat}
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
                 name="lng"
                 value={form.lng}
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
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary">
            Save Event
          </button>
        </div>
      </form>
    </div>
  );
}
