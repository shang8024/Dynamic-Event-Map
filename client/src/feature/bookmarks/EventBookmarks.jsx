import React from "react";
import { Link } from "react-router-dom";

export default function BookmarksPage() {
  return (
    <div className="flex h-screen flex-col px-10 py-2">
      {/* Header Section */}
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center">
          <img src="/logo.png" alt="Dynamic Event Map Logo" className="mt-2" width={50} height={50} />
          <h1 className="ml-2 text-2xl font-bold">My Bookmarks</h1>
        </div>
        <nav className="flex gap-4">
          <Link to="/" className="btn btn-ghost">Back to Map</Link>
        </nav>
      </div>

      {/* Bookmarks Content */}
      <div className="flex-1 p-4">
        <div className="card bg-base-100 shadow-xl">
          <div className="card-body">
            <h2 className="card-title">Bookmarked Events</h2>
            <p>Your saved events will appear here.</p>
            
            {/* Placeholder for bookmarked events */}
            <div className="grid gap-4 mt-4">
              <div className="alert alert-info">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" className="stroke-current shrink-0 w-6 h-6">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path>
                </svg>
                <span>No bookmarks yet.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}