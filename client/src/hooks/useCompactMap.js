import {useSyncExternalStore} from 'react';

const QUERY='(max-aspect-ratio: 1/1), (max-width: 900px)';
function subscribe(notify) {
  if(typeof window==='undefined'||!window.matchMedia) return ()=>{};
  const media=window.matchMedia(QUERY);
  media.addEventListener('change',notify);
  return ()=>media.removeEventListener('change',notify);
}
function snapshot() {return typeof window!=='undefined'&&Boolean(window.matchMedia?.(QUERY).matches);}
function serverSnapshot() {return false;}

export default function useCompactMap() {return useSyncExternalStore(subscribe,snapshot,serverSnapshot);}
