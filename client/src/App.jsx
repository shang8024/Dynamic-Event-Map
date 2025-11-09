import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./App.css";
import BookmarksPage from "./feature/bookmarks/EventBookmarks.jsx";
import { LoadScript } from "@react-google-maps/api";
import EventMap from "./feature/events/EventMap.jsx";
import { useAuth, AuthProvider } from "./contexts/AuthContext.jsx";
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

function AuthorizedRoute({ children }) {
  // Placeholder for actual authorization logic
  const { user } = useAuth();
  if (!user) {
    return (
      <div className="flex h-screen flex-col">
        <Navbar />
        <div className="flex-1 flex items-center justify-center">
          <p className="text-center text-lg">Please log in to access this page.</p>
        </div>
      </div>
    );
  }
  return children;
}

export default function App() {
  const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

  return (
    <AuthProvider>
      <LoadScript googleMapsApiKey={API_KEY} libraries={["places"]}>
        <Router>
          <Routes>
            <Route path="/bookmarks" element={<AuthorizedRoute><BookmarksPage /></AuthorizedRoute>} />
            <Route path="*" element={<HomePage />} />
          </Routes>
        </Router>
      </LoadScript>
    </AuthProvider>
  );
}
