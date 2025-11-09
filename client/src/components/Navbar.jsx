import React from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import GuestAvatar from "../assets/guest.png";

export default function Navbar() {
  const { user, loginWithGoogle, logout } = useAuth();

  return (
    <div className="navbar bg-base-100 px-4 shadow-sm">
      <div className="flex-1">
        <Link to="/" className="flex items-center gap-2 text-xl normal-case">
          <img
            src="/logo.png"
            alt="Dynamic Event Map Logo"
            className="mt-1"
            width={40}
            height={40}
          />
          <span className="hidden sm:inline">Dynamic Events Map</span>
        </Link>
      </div>

      <div className="flex-none">
        {user ? (
          <div>
            <ul className="menu menu-horizontal relative z-50 px-1">
              <li>
                <details className="relative">
                  <summary className="flex cursor-pointer items-center gap-2">
                    <div className="avatar">
                      <div className="w-8 rounded-full">
                        <img src={user.photoURL || GuestAvatar} alt="avatar" />
                      </div>
                    </div>
                    <div className="text-sm font-medium">{user.displayName || user.email}</div>
                  </summary>
                  <ul className="bg-base-100 rounded-box absolute right-0 mt-2 w-52 p-2 shadow">
                    <li>
                      <Link to="/bookmarks">Bookmarks</Link>
                    </li>
                    <li>
                      <button onClick={logout} className="w-full text-left">
                        Logout
                      </button>
                    </li>
                  </ul>
                </details>
              </li>
            </ul>
          </div>
        ) : (
          <button onClick={loginWithGoogle} className="btn btn-primary btn-sm h-8">
            Sign in with Google
          </button>
        )}
      </div>
    </div>
  );
}
