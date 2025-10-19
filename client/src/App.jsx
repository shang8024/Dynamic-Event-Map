import React from "react";
import EventMap from "./feature/events/EventMap.jsx";
import "./App.css";

export default function App() {
  return (
    <div className="flex h-screen flex-col px-10 py-2">
      {/* Header Section */}
      <div className="flex shrink-0 items-center">
        <img src="/logo.png" alt="Dynamic Event Map Logo" className="mt-2" width={50} height={50} />
        <h1 className="ml-2 text-2xl font-bold">Dynamic Events Map</h1>
      </div>

      {/* Map Section - fills remaining height */}
      <div className="flex-1">
        <EventMap />
      </div>
    </div>
  );
}
