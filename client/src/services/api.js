// api.js - Bookmark API service
export async function postBatch(payload) {
  const response = await fetch('/api/bookmarks/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return response.json();
}

export async function fetchEventChanges(since) {
  const response = await fetch(`/api/events/changed?since=${encodeURIComponent(since)}`);
  
  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }
  
  return response.json();
}