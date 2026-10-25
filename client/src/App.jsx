import React,{lazy,Suspense,useEffect,useRef} from "react";
import { createBrowserRouter, RouterProvider, Routes, Route } from "react-router-dom";
import "./App.css";
const BookmarksPage=lazy(()=>import('./feature/bookmarks/EventBookmarks.jsx'));
const UserComments=lazy(()=>import('./feature/comments/UserComments.jsx'));
import useGoogleMaps from './hooks/useGoogleMaps';
import EventMap from "./feature/events/EventMap.jsx";
import { useAuth, AuthProvider } from "./contexts/AuthContext.jsx";
import Navbar from "./components/Navbar.jsx";
import SiteFooter from './components/SiteFooter';
import { NotificationProvider } from "./contexts/NotificationContext.jsx";
import NotificationBanner from "./components/NotificationBanner.jsx";
const PreferencesPage=lazy(()=>import('./components/PreferencesPage.jsx'));
const RecommendationsPage=lazy(()=>import('./components/RecommendationsPage.jsx'));
const UnsubscribePage=lazy(()=>import('./components/UnsubscribePage.jsx'));
const NotificationInbox=lazy(()=>import('./components/NotificationInbox'));
import {AuthFlowProvider,useAuthFlow} from './contexts/AuthFlowContext';
import {Link,useLocation} from 'react-router-dom';
const AuthPage=lazy(()=>import('./components/AuthPage'));
const EventPage=lazy(()=>import('./feature/events/EventPage'));
const EventComposePage=lazy(()=>import('./feature/events/EventComposePage'));
const ContributionsPage=lazy(()=>import('./components/ContributionsPage'));
const MyEventsPage=lazy(()=>import('./components/MyEventsPage'));
const EventSubmissionPage=lazy(()=>import('./components/EventSubmissionPage'));
import './CompactLayout.css';
import UnsavedChangesProvider from './contexts/UnsavedChangesProvider';
import SearchIndexing from './components/SearchIndexing';
import ReviewAccessGate from './components/ReviewAccessGate';

function MapPage() {
  const {isLoaded,loadError}=useGoogleMaps();
  return <EventMap mapsReady={isLoaded} mapsError={loadError}/>;
}

function PageWrapper({ children,map=false }) {
  const page=useRef(null),location=useLocation();
  useEffect(()=>{
    page.current?.scrollTo({top:0});
    if(!['/signin','/register','/reset-password'].includes(location.pathname)&&!location.pathname.startsWith('/events/')) {
      const title={'/bookmarks':'Saved events','/recommendations':'For you','/notifications':'Notifications','/comments':'My comments','/settings':'Settings','/contributions':'Contributions','/my-events':'My events'}[location.pathname];
      document.title=title?`${title} · Dynamic Event Map`:'Dynamic Event Map';
    }
  },[location.pathname]);
  return (
    <div ref={page} className="app-shell" data-page-scroll data-map-page={map||undefined}>
      <Navbar />
      <NotificationBanner />
      <div id="main-content" className="app-content" tabIndex={-1}><Suspense fallback={<p role="status" className="p-6">Loading page…</p>}>{children}</Suspense></div>
      <SiteFooter map={map}/>
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

function AppRoutes() {
  const {user}=useAuth();
  return <><SearchIndexing/><UnsavedChangesProvider><AuthFlowProvider><Routes>
    <Route path="/events/new" element={<AuthorizedRoute><EventComposePage/></AuthorizedRoute>}/>
    <Route path="/events/:eventId/suggest" element={<AuthorizedRoute><EventComposePage/></AuthorizedRoute>}/>
    <Route path="/events/:eventId" element={<PageWrapper><EventPage/></PageWrapper>}/>
    <Route path="/signin" element={<PageWrapper><AuthPage key="signin"/></PageWrapper>}/>
    <Route path="/register" element={<PageWrapper><AuthPage key="register" initialMode="register"/></PageWrapper>}/>
    <Route path="/reset-password" element={<PageWrapper><AuthPage key="reset-password" initialMode="reset"/></PageWrapper>}/>
    <Route path="/notifications" element={<AuthorizedRoute><NotificationInbox/></AuthorizedRoute>}/>
    <Route path="/contributions" element={<AuthorizedRoute><ReviewAccessGate><ContributionsPage key={user?.uid}/></ReviewAccessGate></AuthorizedRoute>}/>
    <Route path="/my-events" element={<AuthorizedRoute><ReviewAccessGate><MyEventsPage key={user?.uid}/></ReviewAccessGate></AuthorizedRoute>}/>
    <Route path="/event-submissions/:submissionId" element={<AuthorizedRoute><EventSubmissionPage key={user?.uid}/></AuthorizedRoute>}/>
    <Route path="/settings" element={<AuthorizedRoute><PreferencesPage/></AuthorizedRoute>}/>
    <Route path="/recommendations" element={<AuthorizedRoute><RecommendationsPage/></AuthorizedRoute>}/>
    <Route path="/unsubscribe" element={<PageWrapper><UnsubscribePage/></PageWrapper>}/>
    <Route path="/bookmarks" element={<AuthorizedRoute><BookmarksPage/></AuthorizedRoute>}/>
    <Route path="/comments" element={<AuthorizedRoute><UserComments/></AuthorizedRoute>}/>
    <Route path="*" element={<PageWrapper map><MapPage/></PageWrapper>}/>
  </Routes></AuthFlowProvider></UnsavedChangesProvider></>;
}

// A data router lets forms protect unsaved changes on links and browser Back.
const router=createBrowserRouter([{path:'*',element:<AppRoutes/>}]);
export default function App() {
  return (
    <NotificationProvider>
      <AuthProvider>
        <RouterProvider router={router}/>
      </AuthProvider>
    </NotificationProvider>
  );
}
