const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '/api';

function getToken() {
  return localStorage.getItem('idToken');
}

export async function authFetch(path, opts = {}) {
  const token = getToken();
  const headers = opts.headers ? { ...opts.headers } : {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export async function authPost(path, payload) {
  return authFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
}

export default { authFetch, authPost };
