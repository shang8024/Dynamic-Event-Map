import React, { useState, useEffect } from "react";

export default function EventForm({ initialData = {}, onSaved, onCancel }) {
  const [form, setForm] = useState({
    title: "",
    description: "",
    address: "",
    lat: "",
    lng: "",
  });

  useEffect(() => {
    if (initialData) {
      setForm({
        address: initialData.address || "",
        lat: initialData.lat || "",
        lng: initialData.lng || "",
        title: "",
        description: "",
      });
    }
  }, [initialData]);

  const handleChange = (e) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = (e) => {
    e.preventDefault();
    onSaved({
      id: Date.now(),
      ...form,
      lat: Number(form.lat),
      lng: Number(form.lng),
    });
  };

  return (
    <form className="space-y-3" onSubmit={handleSubmit}>
      <input
        type="text"
        name="address"
        value={form.address}
        readOnly
        className="input input-bordered w-full"
      />

      <div className="flex gap-2">
        <input
          type="text"
          name="lat"
          value={form.lat}
          readOnly
          className="input input-bordered w-full"
        />
        <input
          type="text"
          name="lng"
          value={form.lng}
          readOnly
          className="input input-bordered w-full"
        />
      </div>

      <input
        type="text"
        name="title"
        placeholder="Event Title"
        value={form.title}
        onChange={handleChange}
        className="input input-bordered w-full"
      />

      <textarea
        name="description"
        placeholder="Event Description"
        value={form.description}
        onChange={handleChange}
        className="textarea textarea-bordered w-full"
      />

      <div className="modal-action">
        <button type="submit" className="btn btn-primary">
          Save
        </button>
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
