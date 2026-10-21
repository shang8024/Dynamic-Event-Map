import { auth } from '../firebase';

export async function getVerifiedIdToken() {
  const account = auth.currentUser;
  if (!account?.emailVerified) return null;
  // Firebase refreshes an expired/expiring token before returning it. Do not keep
  // a second, potentially stale copy in application localStorage.
  const result = await account.getIdTokenResult();
  return result.claims.email_verified === true ? result.token : null;
}
