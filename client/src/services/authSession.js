export function publicAccount(firebaseUser) {
  if (!firebaseUser) return null;
  return {
    uid: firebaseUser.uid,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL,
    emailVerified: firebaseUser.emailVerified === true,
  };
}

export async function resolveAuthSession(firebaseUser, syncProfile) {
  const account = publicAccount(firebaseUser);
  if (!account?.emailVerified) return { account, user: null };
  const tokenResult = await firebaseUser.getIdTokenResult();
  if (tokenResult.claims.email_verified !== true) {
    return { account: { ...account, emailVerified: false }, user: null };
  }
  const profile = await syncProfile(tokenResult.token);
  if (!profile?.id) {
    const error = new Error('Profile unavailable');
    error.code = 'app/profile-unavailable';
    throw error;
  }
  return {
    account,
    user: { ...account, id: profile.id, role: profile.role === 'admin' ? 'admin' : 'member', displayName: account.displayName || profile.username || account.email },
  };
}

export function profileSyncErrorCode(status, code) {
  if (status === 403 && code === 'account_disabled') return 'app/account-disabled';
  if (status === 401 && code === 'session_revoked') return 'app/session-revoked';
  if (status === 429) return 'app/rate-limited';
  if (status === 409) return 'app/account-link-required';
  if (status === 403) return 'app/email-not-verified';
  return 'app/profile-unavailable';
}

export function authErrorMessage(error) {
  if (error?.code === 'app/password-policy') return error.message;
  const messages = {
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/missing-password': 'Enter your password.',
    'auth/invalid-credential': 'The email or password is incorrect. Try again or reset your password.',
    'auth/invalid-login-credentials': 'The email or password is incorrect. Try again or reset your password.',
    'auth/wrong-password': 'The email or password is incorrect. Try again or reset your password.',
    'auth/user-not-found': 'The email or password is incorrect. Try again or reset your password.',
    'auth/email-already-in-use': 'We could not create an account with this email. Try signing in or resetting your password.',
    'auth/weak-password': 'Choose a stronger password with at least 8 characters.',
    'auth/password-does-not-meet-requirements': 'Your password does not meet the account password requirements. Try a longer password with letters, numbers and a symbol.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes before trying again.',
    'auth/network-request-failed': 'Check your connection and try again.',
    'auth/popup-closed-by-user': 'Sign-in was closed. You can try again when you are ready.',
    'auth/cancelled-popup-request': 'Another sign-in window is already open.',
    'auth/popup-blocked': 'Allow pop-ups for this site to continue with Google.',
    'auth/account-exists-with-different-credential': 'Use the sign-in method you previously used for this email.',
    'auth/user-disabled': 'This account is unavailable. Please contact support.',
    'auth/user-token-expired': 'Your session has expired. Please sign out and sign in again.',
    'auth/requires-recent-login': 'Please sign out and sign in again to continue.',
    'auth/operation-not-allowed': 'This sign-in option is temporarily unavailable. Please try another option.',
    'auth/unauthorized-domain': 'Sign-in is not available at this address yet. Please try the main website.',
    'app/account-link-required': 'This email is connected to another account. Use your original sign-in method or contact support.',
    'app/email-not-verified': 'Verify your email, then check your verification again.',
    'app/account-disabled': 'This account is unavailable. Please contact support.',
    'app/session-revoked': 'Your session was ended. Please sign out and sign in again.',
    'app/rate-limited': 'Too many requests. Please wait a few minutes before trying again.',
    'app/profile-unavailable': 'We could not finish loading your account. Please try again.',
    'app/display-name-invalid': 'Enter a display name between 1 and 50 characters.',
  };
  return messages[error?.code] || 'Something went wrong. Please try again.';
}

export async function requestPasswordReset(sendReset, email) {
  try { await sendReset(email.trim()); }
  catch (error) {
    // Both outcomes produce the same UI confirmation, including on projects
    // where Firebase's email enumeration protection is not yet enabled.
    if (error.code !== 'auth/user-not-found') throw error;
  }
}

export function passwordPolicyMessage(status) {
  const requirements = [];
  const options = status.passwordPolicy?.customStrengthOptions || {};
  if (status.meetsMinPasswordLength === false) requirements.push(`at least ${options.minPasswordLength || 8} characters`);
  if (status.meetsMaxPasswordLength === false) requirements.push(`no more than ${options.maxPasswordLength} characters`);
  if (status.containsLowercaseLetter === false) requirements.push('a lowercase letter');
  if (status.containsUppercaseLetter === false) requirements.push('an uppercase letter');
  if (status.containsNumericCharacter === false) requirements.push('a number');
  if (status.containsNonAlphanumericCharacter === false) requirements.push('a symbol');
  return requirements.length ? `Your password needs ${requirements.join(', ')}.` : 'Choose a stronger password.';
}
