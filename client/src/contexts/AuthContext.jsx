import React, { createContext, useContext, useEffect, useState } from "react";
import { auth, googleProvider } from "../firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { API_BASE } from "../services/apiService";
import { useNotifications } from "./NotificationContext";
import { checkActivity } from "../utils/activity";

const AuthContext = createContext(null);

const getProfileByGoogleId = async (uid, token) => {
  try {
    const response = await fetch(`${API_BASE}/profiles/${uid}`, {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) throw new Error("Failed to fetch profile");
    return response.json();
  } catch (error) {
    console.error("Error fetching profile:", error);
    return null;
  }
};

const addUserToBackend = async (user, token) => {
  try {
    const response = await fetch(`${API_BASE}/profiles`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        photoURL: user.photoURL,
      }),
    });
    if (!response.ok) throw new Error("Failed to add user");
    console.log("User added to backend");
  } catch (error) {
    console.error("Error adding user to backend:", error);
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const { push } = useNotifications();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      if (fbUser) {
        const token = await fbUser.getIdToken();
        // store token for API usage (or keep in memory)
        localStorage.setItem("idToken", token);
        await addUserToBackend(fbUser, token); // wait to update backend so profile ID is ready
        const profile = await getProfileByGoogleId(fbUser.uid, token);
        setUser({
          uid: fbUser.uid, // google ID
          email: fbUser.email,
          displayName: fbUser.displayName,
          photoURL: fbUser.photoURL,
          id: profile.id, // primary key used for comments and bookmarks
        });
        push({ type: "success", message: `Welcome, ${fbUser.displayName}!`, autoCloseMs: 3000 });
      } else {
        localStorage.removeItem("idToken");
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const loginWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
    // onAuthStateChanged will handle setting token and user
  };

  const logout = async () => {
    try {
      await signOut(auth);
      localStorage.removeItem("idToken");
      setUser(null);
    } catch (err) {
      console.error("Logout error", err);
    }
  };

  // Effect which logs out idle users
  useEffect(() => {
    let checkActivityInterval;
    if (user) {
      const interval_ms = 59*60*1000; // Check activity after 59 minutes as tokens expire in 1 hour
      checkActivityInterval = setInterval(async () => {
        // Check if user is still logged in
        const currentUser = auth.currentUser;
        if (!currentUser) return;

        if (checkActivity()) {
          try {
            const token = await currentUser.getIdToken(true); // Force token refresh if user has been active
            localStorage.setItem('idToken', token);
          } catch(error) {
            console.error("Failed to refresh authorization token.");
          }
        } else {
          console.log("Current user has been idle for too long - log them out for security and to avoid errors from token expiration.")
          await logout();
          // Keep notification up without an auto close interval so idle user can see when they get back
          push({ type: "info", message: `You have been logged out due to extended inactivity.\nPlease log in again.`});
        }
      }, interval_ms);
    }

    return () => {
      if (checkActivityInterval) clearInterval(checkActivityInterval);
    }
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
