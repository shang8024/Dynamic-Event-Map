// storage.js
const K = {
  BOOKMARKS: 'bm:bookmarks',
  EVENTS: 'bm:eventsCache',
  QUEUE: 'bm:opQueue'
};

function readJSON(k, fallback) {
  try { 
    const v = localStorage.getItem(k); 
    return v ? JSON.parse(v) : fallback; 
  }
  catch (error) { 
    console.warn('Failed to read from localStorage:', error);
    return fallback; 
  }
}

function writeJSON(k, v) {
  try { 
    localStorage.setItem(k, JSON.stringify(v)); 
  } catch (error) {
    // Silently fail if localStorage is not available
    console.warn('Failed to write to localStorage:', error);
  }
}

export { K, readJSON, writeJSON };