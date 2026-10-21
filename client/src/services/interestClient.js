const preferenceKeys = ["reminders_enabled", "marketing_enabled", "personalization_enabled"];

export function preferencePayload(value) {
  if (!value || preferenceKeys.some((key) => typeof value[key] !== "boolean")) {
    throw new Error("Choose each preference before saving.");
  }
  if (![1, 24].includes(value.reminder_lead_hours)) {
    throw new Error("Choose a reminder time of 1 hour or 24 hours.");
  }
  // The current identity always comes from the verified token. Never send a
  // profile ID, email address, timezone, or arbitrary server fields as updates.
  return Object.fromEntries(
    [...preferenceKeys, "reminder_lead_hours"].map((key) => [key, value[key]])
  );
}

export function createInterestClient({ baseUrl, getToken, fetchImpl = fetch }) {
  async function request(path, { method = "GET", body, signal, authenticated = true } = {}) {
    const headers = {};
    if (authenticated) {
      const token = await getToken();
      if (!token) throw new Error("Sign in with a verified email to continue.");
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      signal,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) {
      if (!authenticated && response.status === 400) {
        throw new Error(
          "This unsubscribe link is invalid or expired. Sign in to change your email preferences instead."
        );
      }
      const message =
        response.status === 401
          ? "Please sign in again to continue."
          : response.status === 403
            ? "Verify your email before continuing."
            : "This service is temporarily unavailable. Please try again.";
      throw new Error(message);
    }
    return response.json();
  }
  return {
    getPreferences: (signal) => request("/me/preferences", { signal }),
    savePreferences: (value, signal) =>
      request("/me/preferences", { method: "PUT", body: preferencePayload(value), signal }),
    getRecommendations: (signal) => request("/recommendations?limit=12", { signal }),
    unsubscribe: (token, signal) => {
      if (typeof token !== "string" || !token || token.length > 4096)
        throw new Error("This unsubscribe link is invalid.");
      return request("/notifications/unsubscribe", {
        method: "POST",
        body: { token },
        signal,
        authenticated: false,
      });
    },
  };
}
