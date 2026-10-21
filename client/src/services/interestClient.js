import {ApiError,clientError,requestJSON} from './apiErrors.js';
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
      let token;try {token=await getToken();} catch(error) {throw clientError(error);}
      if (!token) throw new ApiError("Sign in with a verified email to continue.",{status:401,code:'sign_in_required'});
      headers.Authorization = `Bearer ${token}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return requestJSON(`${baseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      signal,
      unsubscribe:!authenticated,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },fetchImpl);
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
