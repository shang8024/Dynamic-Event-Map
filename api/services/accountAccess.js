function accountAccessReason(profile, identity = {}) {
  if (!profile) return 'account_unavailable';
  if (profile.disabled_at != null) return 'account_disabled';
  if (profile.token_valid_after == null) return null;
  const cutoff = new Date(profile.token_valid_after).getTime();
  if (!Number.isFinite(cutoff)) return 'account_unavailable';
  // auth_time changes only on a fresh sign-in/reauthentication. An ordinary
  // ID-token refresh changes iat and must not restore a revoked session.
  if (!Number.isSafeInteger(identity.auth_time) || identity.auth_time < Math.ceil(cutoff / 1000)) return 'session_revoked';
  return null;
}

module.exports = {accountAccessReason};
