export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:5000";
export const API_BASE = `${API_BASE_URL}/api`;

export async function get(url) {
  const headers = {};
  const token = localStorage.getItem("idToken");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, { headers });
  if (!res.ok) {
    let errorMessage = `Failed to fetch ${url}: ${res.status}`;
    try {
      const errorData = await res.json();
      if (errorData.error) errorMessage = errorData.error;
    } catch {
      // ignore, use default
    }
    throw new Error(errorMessage);
  }
  return res.json();
}

export async function post(url, data) {
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem("idToken");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    let errorMessage = `Failed to post ${url}: ${res.status}`;
    try {
      const errorData = await res.json();
      if (errorData.error) errorMessage = errorData.error;
    } catch {
      // ignore, use default
    }
    throw new Error(errorMessage);
  }
  return res.json();
}

export async function del(url) {
  const headers = {};
  const token = localStorage.getItem("idToken");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, {
    method: "DELETE",
    headers,
  });
  if (!res.ok) {
    let errorMessage = `Failed to delete ${url}: ${res.status}`;
    try {
      const errorData = await res.json();
      if (errorData.error) errorMessage = errorData.error;
    } catch {
      // ignore, use default
    }
    throw new Error(errorMessage);
  }
  return res.json();
}

export async function put(url, data) {
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem("idToken");
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${url}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    let errorMessage = `Failed to put ${url}: ${res.status}`;
    try {
      const errorData = await res.json();
      if (errorData.error) errorMessage = errorData.error;
    } catch {
      // ignore, use default
    }
    throw new Error(errorMessage);
  }
  return res.json();
}
