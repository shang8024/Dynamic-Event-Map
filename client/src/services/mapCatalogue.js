import {responseError} from './apiErrors.js';

export function createMapCatalogueClient({base='/api',fetchImpl=fetch,maximum=12}={}) {
  const cache=new Map();
  return async function fetchMapEvents(query='',{signal}={}) {
    const key=query.trim().toLowerCase(),previous=cache.get(key);
    const response=await fetchImpl(`${base}/events/map${key?`?q=${encodeURIComponent(key)}`:''}`,{
      signal:signal||AbortSignal.timeout(20000),credentials:'omit',headers:previous?{'If-None-Match':previous.etag}:{},
    });
    if(response.status===304&&previous) return previous.rows;
    if(!response.ok) throw await responseError(response);
    const rows=await response.json();
    if(!Array.isArray(rows)) throw new Error('Invalid event catalogue');
    if(signal?.aborted) throw signal.reason;
    const etag=response.headers.get('ETag');
    if(etag) {cache.delete(key);cache.set(key,{rows,etag});while(cache.size>maximum) cache.delete(cache.keys().next().value);}
    return rows;
  };
}
