import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./App.css";
import BookmarksPage from "./feature/bookmarks/EventBookmarks.jsx";
import { LoadScript } from "@react-google-maps/api";
import EventMap from "./feature/events/EventMap.jsx";
import { AuthProvider } from "./contexts/AuthContext.jsx";
import Navbar from "./components/Navbar.jsx";

function HomePage() {
  return (
    <div className="flex h-screen flex-col">
      <Navbar />
      {/* Map Section - fills remaining height */}
      <div className="flex-1 px-10 py-2">
        <EventMap />
      </div>
    </div>
  );
}

export default function App() {
  const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

  return (
    <AuthProvider>
      <LoadScript googleMapsApiKey={API_KEY} libraries={["places"]}>
        <Router>
          <Routes>
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </Router>
      </LoadScript>
    </AuthProvider>
  );
}
