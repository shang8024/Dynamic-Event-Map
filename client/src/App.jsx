import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import "./App.css";
import BookmarksPage from "./feature/bookmarks/EventBookmarks.jsx";
import UserComments from "./feature/comments/UserComments.jsx";
import { useJsApiLoader } from "@react-google-maps/api";
import EventMap from "./feature/events/EventMap.jsx";
import { useAuth, AuthProvider } from "./contexts/AuthContext.jsx";
import Navbar from "./components/Navbar.jsx";
import { NotificationProvider } from "./contexts/NotificationContext.jsx";
import NotificationBanner from "./components/NotificationBanner.jsx";
import PreferencesPage from "./components/PreferencesPage.jsx";
import RecommendationsPage from "./components/RecommendationsPage.jsx";
import UnsubscribePage from "./components/UnsubscribePage.jsx";
import NotificationInbox from "./components/NotificationInbox";

const MAP_LIBRARIES=["places","marker"];
function MapPage() {
  const {isLoaded,loadError}=useJsApiLoader({id:'eventmap-google-maps',googleMapsApiKey:import.meta.env.VITE_GOOGLE_MAPS_KEY,libraries:MAP_LIBRARIES});
  if(loadError) return <div role="alert" className="p-6">The map could not be loaded. Check your connection and <button className="link" onClick={()=>window.location.reload()}>try again</button>.</div>;
  return isLoaded?<EventMap/>:<p role="status" className="p-4">Loading map…</p>;
}

function PageWrapper({ children }) {
  return (
    <div className="app-shell">
      <Navbar />
      <div className="app-content">{children}</div>
    </div>
  );
}

function AuthorizedRoute({ children }) {
  const { user, account, loading } = useAuth();
  if (!user) {
    return (
      <PageWrapper>
        <div className="items-center justify-center">
          <p role="status" className="text-center text-lg">
            {loading
              ? "Loading your account…"
              : account && !account.emailVerified
                ? "Verify your email to access this page. Use Verify email above to continue."
                : account
                  ? "Finish signing in above to access this page."
                  : "Sign in or create an account above to access this page."}
          </p>
        </div>
      </PageWrapper>
    );
  }
  return <PageWrapper>{children}</PageWrapper>;
}

export default function App() {
  return (
    <NotificationProvider>
      <NotificationBanner />
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/notifications" element={<AuthorizedRoute><NotificationInbox /></AuthorizedRoute>} />
            <Route
              path="/settings"
              element={
                <AuthorizedRoute>
                  <PreferencesPage />
                </AuthorizedRoute>
              }
            />
            <Route
              path="/recommendations"
              element={
                <AuthorizedRoute>
                  <RecommendationsPage />
                </AuthorizedRoute>
              }
            />
            <Route
              path="/unsubscribe"
              element={
                <PageWrapper>
                  <UnsubscribePage />
                </PageWrapper>
              }
            />
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
                  <MapPage />
                </PageWrapper>
              }
            />
          </Routes>
        </Router>
      </AuthProvider>
    </NotificationProvider>
  );
}
