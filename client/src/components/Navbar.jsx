import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import GuestAvatar from "../assets/guest.png";
import AuthDialog from "./AuthDialog";
import { NotificationBell } from "./NotificationInbox";
import { authErrorMessage } from "../services/authSession";

export default function Navbar() {
  const { user, account, loading, logout } = useAuth();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("signin");
  const [logoutError, setLogoutError] = useState("");
  const closeAuth = useCallback(() => setAuthOpen(false), []);
  const openAuth = (mode) => {
    setAuthMode(mode);
    setAuthOpen(true);
  };
  const handleLogout = async () => {
    setLogoutError("");
    try {
      await logout();
    } catch (error) {
      setLogoutError(authErrorMessage(error));
    }
  };

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

      <div className="flex flex-none items-center gap-1">
        {user && <NotificationBell />}
        {logoutError && (
          <span role="alert" className="text-error mr-3 max-w-48 text-xs">
            {logoutError}
          </span>
        )}
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
                    <div className="max-w-36 truncate text-sm font-medium">{user.role === 'admin' ? 'Admin' : user.displayName || user.email}</div>
                  </summary>
                  <ul className="bg-base-100 rounded-box absolute right-0 mt-2 w-52 p-2 shadow">
                    <li>
                      <Link to="/bookmarks">Bookmarks</Link>
                    </li>
                    <li>
                      <Link to="/comments">My Comments</Link>
                    </li>
                    <li>
                      <Link to="/recommendations">Recommendations</Link>
                    </li>
                    <li>
                      <Link to="/settings">Notifications & privacy</Link>
                    </li>
                    <li>
                      <button onClick={handleLogout} className="w-full text-left">
                        Sign out
                      </button>
                    </li>
                  </ul>
                </details>
              </li>
            </ul>
          </div>
        ) : account ? (
          <button onClick={() => openAuth("signin")} className="btn btn-primary btn-sm">
            {account.emailVerified ? "Finish signing in" : "Verify email"}
          </button>
        ) : (
          <div className="flex items-center gap-2">
            <button
              onClick={() => openAuth("signin")}
              className="btn btn-ghost btn-sm"
              disabled={loading}
            >
              {loading ? "Loading…" : "Sign in"}
            </button>
            <button
              onClick={() => openAuth("register")}
              className="btn btn-primary btn-sm"
              disabled={loading}
            >
              Create account
            </button>
          </div>
        )}
      </div>
      <AuthDialog open={authOpen} initialMode={authMode} onClose={closeAuth} />
    </div>
  );
}
