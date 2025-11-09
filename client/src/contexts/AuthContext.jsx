import React, { createContext, useContext, useEffect, useState } from "react";
import { auth, googleProvider } from "../firebase";
import { signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";
import { API_BASE } from "../services/apiService";

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
    const response = await fetch("http://localhost:5000/api/profiles", {
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
        console.log("User logged in:", fbUser.displayName);
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

  return (
    <AuthContext.Provider value={{ user, loading, loginWithGoogle, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
