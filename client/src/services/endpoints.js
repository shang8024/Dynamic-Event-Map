// Accept either an API origin or a full /api base without duplicating the prefix.
export function apiBase(value = "/api") {
  const base = value.trim().replace(/\/+$/, "");
  return base.endsWith("/api") ? base : `${base}/api`;
}

export function socketEndpoint(value, origin) {
  return { url: new URL(apiBase(value), origin).origin, path: "/socket.io" };
}
