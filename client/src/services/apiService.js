export const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:5000/api";

export async function get(url) {
  const res = await fetch(`${API_BASE}${url}`);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.json();
}

export async function post(url, data) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to post ${url}: ${res.status}`);
  return res.json();
}

export async function del(url) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(`Failed to delete ${url}: ${res.status}`);
  return res.json();
}

export async function put(url, data) {
  const res = await fetch(`${API_BASE}${url}`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Failed to put ${url}: ${res.status}`);
  return res.json();
}
