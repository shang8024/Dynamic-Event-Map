import React from "react";
import EventMap from "./feature/events/EventMap";
import "./App.css";

export default function App() {
  return (
    <div className="min-h-screen p-4">
      <h1 className="text-2xl font-bold mb-4">Toronto Events Map</h1>
      <EventMap />
    </div>
  );
}
