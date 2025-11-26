import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./App.css";
import BookmarksPage from "./feature/bookmarks/EventBookmarks.jsx";
import UserComments from "./feature/comments/UserComments.jsx";
import { LoadScript } from "@react-google-maps/api";
import EventMap from "./feature/events/EventMap.jsx";
import { useAuth, AuthProvider } from "./contexts/AuthContext.jsx";
import Navbar from "./components/Navbar.jsx";
import { NotificationProvider } from "./contexts/NotificationContext.jsx";
import NotificationBanner from "./components/NotificationBanner.jsx";

function PageWrapper({ children }) {
  return (
    <div className="flex h-dvh flex-col gap-4 overflow-hidden">
      <Navbar />
      <div className="h-dvh overflow-auto px-4">{children}</div>
    </div>
  );
}

function AuthorizedRoute({ children }) {
  // Placeholder for actual authorization logic
  const { user } = useAuth();
  if (!user) {
    return (
      <PageWrapper>
        <div className="items-center justify-center">
          <p className="text-center text-lg">Please log in to access this page.</p>
        </div>
      </PageWrapper>
    );
  }
  return <PageWrapper>{children}</PageWrapper>;
}

export default function App() {
  const API_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY;

  return (
    <NotificationProvider>
      <NotificationBanner />
      <AuthProvider>
        <LoadScript googleMapsApiKey={API_KEY} libraries={["places"]}>
          <Router>
            <Routes>
              <Route
                path="/bookmarks"
                element={
                  <AuthorizedRoute>
                    <BookmarksPage />
                  </AuthorizedRoute>
                }
              />
              <Route
                path="/comments"
                element={
                  <AuthorizedRoute>
                    <UserComments />
                  </AuthorizedRoute>
                }
              />
              <Route
                path="*"
                element={
                  <PageWrapper>
                    <EventMap />
                  </PageWrapper>
                }
              />
            </Routes>
          </Router>
        </LoadScript>
      </AuthProvider>
    </NotificationProvider>
  );
}
