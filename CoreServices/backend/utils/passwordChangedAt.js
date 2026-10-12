// Token revocation by password change. A JWT whose iat (seconds) is earlier
// than the user's passwordChangedAt is no longer accepted.

// One second in the past, so a token issued in the same request that changes
// the password (iat = now, floored to seconds) is not rejected.
export const passwordChangedTimestamp = () => new Date(Date.now() - 1000);

export const isTokenRevoked = (iat, passwordChangedAt) => {
  if (!passwordChangedAt) return false;
  if (typeof iat !== 'number') return true; // cannot prove the token is newer
  const changedAtSeconds = Math.floor(new Date(passwordChangedAt).getTime() / 1000);
  return iat < changedAtSeconds;
};
