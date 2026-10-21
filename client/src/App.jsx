import React,{useEffect,useRef} from "react";
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
import {AuthFlowProvider,useAuthFlow} from './contexts/AuthFlowContext';
import {Link,useLocation} from 'react-router-dom';

const MAP_LIBRARIES=["places","marker"];
function MapPage() {
  const {isLoaded,loadError}=useJsApiLoader({id:'eventmap-google-maps',googleMapsApiKey:import.meta.env.VITE_GOOGLE_MAPS_KEY,libraries:MAP_LIBRARIES});
  if(loadError) return <div role="alert" className="p-6">The map could not be loaded. Check your connection and <button className="link" onClick={()=>window.location.reload()}>try again</button>.</div>;
  return isLoaded?<EventMap/>:<p role="status" className="p-4">Loading map…</p>;
}

function PageWrapper({ children }) {
  const content=useRef(null),location=useLocation();
  useEffect(()=>{content.current?.scrollTo({top:0});},[location.pathname]);
  return (
    <div className="app-shell">
      <Navbar />
      <NotificationBanner />
      <div ref={content} id="main-content" className="app-content" tabIndex={-1}>{children}</div>
    </div>
  );
}

function AuthorizedRoute({ children }) {
  const { user, account, loading } = useAuth();
  const requestAuth=useAuthFlow();
  if (!user) {
    return (
      <PageWrapper>
        <main className="account-gate">
          <p className="eyebrow">Your event space</p>
          <h1>{loading?'Loading your account…':account&&!account.emailVerified?'Verify your email to continue':'Make room for your next plan'}</h1>
          <p>Save events, find recommendations and keep up with your conversations. Your saved history stays here after an event ends.</p>
          {!loading && <div className="flex flex-wrap justify-center gap-3"><button className="btn btn-primary" onClick={()=>requestAuth('continue to your account')}>{account?'Continue sign-in':'Sign in or create an account'}</button><Link className="btn btn-ghost" to="/">Explore the map</Link></div>}
        </main>
      </PageWrapper>
    );
  }
  return <PageWrapper>{children}</PageWrapper>;
}

export default function App() {
  return (
    <NotificationProvider>
      <AuthProvider>
        <Router>
          <AuthFlowProvider>
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
          </AuthFlowProvider>
        </Router>
      </AuthProvider>
    </NotificationProvider>
  );
}
