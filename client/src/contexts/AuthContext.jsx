import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  createUserWithEmailAndPassword, onIdTokenChanged, reload, sendEmailVerification,
  sendPasswordResetEmail, signInWithEmailAndPassword, signInWithPopup, signOut,
  updateProfile, validatePassword,
} from 'firebase/auth';
import { auth, googleProvider } from '../firebase';
import { API_BASE } from '../services/apiService';
import { authErrorMessage, passwordPolicyMessage, publicAccount, requestPasswordReset, resolveAuthSession } from '../services/authSession';

const AuthContext = createContext(null);

async function syncProfile(token) {
  let response;
  try {
    response = await fetch(`${API_BASE}/auth/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw Object.assign(new Error('Account sync unavailable'), { code: 'app/profile-unavailable' });
  }
  if (!response.ok) {
    const error = new Error('Account sync failed');
    error.code = response.status === 409 ? 'app/account-link-required'
      : response.status === 403 ? 'app/email-not-verified' : 'app/profile-unavailable';
    throw error;
  }
  return (await response.json()).user;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [account, setAccount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [verificationSentAt, setVerificationSentAt] = useState(0);
  const revision = useRef(0);
  const invalidateSession = useCallback(() => { revision.current++; }, []);

  const synchronize = useCallback(async (firebaseUser) => {
    const currentRevision = ++revision.current;
    setAccount(publicAccount(firebaseUser));
    setUser(previous => previous?.uid === firebaseUser?.uid && firebaseUser?.emailVerified ? previous : null);
    setLoading(true);
    setSessionError('');
    try {
      const session = await resolveAuthSession(firebaseUser, syncProfile);
      if (currentRevision !== revision.current) return null;
      setAccount(session.account);
      setUser(session.user);
      return session;
    } catch (error) {
      if (currentRevision === revision.current) {
        setUser(null);
        setSessionError(authErrorMessage(error));
      }
      return null;
    } finally {
      if (currentRevision === revision.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Remove the legacy manually cached bearer token. Firebase owns persistence
    // and API helpers now request the current token directly from its SDK.
    try { localStorage.removeItem('idToken'); } catch { /* Storage may be disabled. */ }
    const unsubscribe = onIdTokenChanged(auth, firebaseUser => { void synchronize(firebaseUser); });
    return () => { invalidateSession(); unsubscribe(); };
  }, [invalidateSession, synchronize]);

  const loginWithGoogle = useCallback(() => signInWithPopup(auth, googleProvider), []);
  const loginWithEmail = useCallback((email, password) => signInWithEmailAndPassword(auth, email.trim(), password), []);

  const sendVerification = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) throw Object.assign(new Error('Sign in required'), { code: 'auth/user-token-expired' });
    await sendEmailVerification(current);
    setVerificationSentAt(Date.now());
  }, []);

  const registerWithEmail = useCallback(async ({ displayName, email, password }) => {
    if (!displayName.trim() || displayName.trim().length > 50) throw Object.assign(new Error('Invalid display name'), { code: 'app/display-name-invalid' });
    if (password.length < 8) throw Object.assign(new Error('Use at least 8 characters for your password.'), { code: 'app/password-policy' });
    const policy = await validatePassword(auth, password);
    if (!policy.isValid) throw Object.assign(new Error(passwordPolicyMessage(policy)), { code: 'app/password-policy' });
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    let nameSaved = true;
    try { await updateProfile(credential.user, { displayName: displayName.trim() }); }
    catch { nameSaved = false; }
    await synchronize(credential.user);
    try { await sendVerification(); }
    catch (error) {
      // Account creation succeeded even when mail delivery failed. Keep the
      // signed-in verification screen and let the person retry there.
      error.verificationAfterSignup = true;
      throw error;
    }
    return { nameSaved };
  }, [sendVerification, synchronize]);

  const refreshAccount = useCallback(async () => {
    const current = auth.currentUser;
    if (!current) throw Object.assign(new Error('Sign in required'), { code: 'auth/user-token-expired' });
    await reload(current);
    await current.getIdToken(true);
    await synchronize(current);
    return current.emailVerified;
  }, [synchronize]);

  const resetPassword = useCallback(async (email) => {
    await requestPasswordReset(address => sendPasswordResetEmail(auth, address), email);
  }, []);

  const logout = useCallback(async () => {
    await signOut(auth);
    // Invalidate an earlier profile request so it cannot restore a signed-out user.
    invalidateSession();
    setUser(null); setAccount(null); setLoading(false); setSessionError('');
    setVerificationSentAt(0);
  }, [invalidateSession]);

  return (
    <AuthContext.Provider value={{
      user, account, loading, sessionError, verificationSentAt,
      loginWithGoogle, loginWithEmail, registerWithEmail, sendVerification,
      refreshAccount, resetPassword, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
