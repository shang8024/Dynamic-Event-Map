import {useEffect,useState} from 'react';
import socket,{onRealtimeWake} from '../services/socket';
import {fetchBookmarkStats} from '../services/bookmarksService';
export function useCountBookmarks(eventId) {
  const [count,setCount]=useState(null);
  useEffect(()=>{
    if(!eventId) return;
    let active=true;setCount(null);
    async function refresh(){try {const result=await fetchBookmarkStats(eventId);if(active) setCount(result.bookmark_count);} catch {/* Existing count remains available. */}}
    const update=payload=>{if(String(payload.eventId)===String(eventId)) setCount(payload.count);};
    socket.on('bookmark:updated',update);const stop=onRealtimeWake(refresh);void refresh();
    return()=>{active=false;socket.off('bookmark:updated',update);stop();};
  },[eventId]);
  return count;
}
