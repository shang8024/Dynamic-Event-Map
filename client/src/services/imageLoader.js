const allowed=src=>typeof src==='string'&&/^\/api\/events\/[1-9]\d{0,9}\/image(?:\?[^#\s]*)?$/.test(src);

// Share requests between map/list/detail, leave admission headroom for other
// visitors, and never send the browser directly to a submitted image URL.
export function createImageLoader({fetchImpl=fetch,makeURL=blob=>URL.createObjectURL(blob),revokeURL=url=>URL.revokeObjectURL(url),
  concurrency=4,maximumBytes=8*1024*1024,budget=80,windowMs=60000,now=()=>Date.now()}={}) {
  const entries=new Map(),queue=[],recent=[];let active=0,bytes=0,timer=null,blockedUntil=0;
  function prune() {
    for(const [key,item] of entries) if(!item.listeners.size&&(item.until<=now()||bytes>maximumBytes||entries.size>160)) {
      if(item.url){revokeURL(item.url);bytes-=item.bytes;}entries.delete(key);
    }
  }
  function schedule(delay=0) {
    if(timer)clearTimeout(timer);
    timer=setTimeout(()=>{timer=null;pump();},Math.max(0,delay));
  }
  function pump() {
    prune();while(recent.length&&recent[0]<=now()-windowMs)recent.shift();
    queue.sort((a,b)=>b.priority-a.priority||a.created-b.created);
    while(active<concurrency&&queue.length) {
      const ready=queue.findIndex(item=>item.at<=now());
      if(now()<blockedUntil||recent.length>=budget||ready<0) {
        const at=Math.max(blockedUntil,recent.length>=budget?recent[0]+windowMs:now(),ready<0?Math.min(...queue.map(item=>item.at)):now());
        schedule(at-now()+1);break;
      }
      const [item]=queue.splice(ready,1);
      if(!item.listeners.size){entries.delete(item.src);continue;}
      active++;recent.push(now());item.attempts++;item.state='loading';item.controller=new AbortController();
      void load(item).finally(()=>{active--;pump();});
    }
    if(!queue.length&&timer){clearTimeout(timer);timer=null;}
  }
  async function load(item) {
    try {
      const response=await fetchImpl(item.src,{signal:AbortSignal.any([item.controller.signal,AbortSignal.timeout(20000)]),credentials:'omit'});
      if(!response.ok) {
        await response.body?.cancel();
        const retryable=[429,500,502,503,504].includes(response.status);
        const header=response.headers.get('Retry-After'),seconds=/^\d+$/.test(header||'')?Number(header):Math.max(0,(Date.parse(header)-now())/1000);
        const delay=Math.min(60000,Math.max(1000,Number.isFinite(seconds)?seconds*1000:1000*2**(item.attempts-1)));
        if(response.status===429||response.status===503)blockedUntil=Math.max(blockedUntil,now()+delay);
        throw Object.assign(new Error('Image unavailable'),{retryable,delay});
      }
      if(response.headers.get('Content-Type')?.split(';')[0]!=='image/webp') {await response.body?.cancel();throw new Error('Unsupported image response');}
      const chunks=[];let size=0;const reader=response.body.getReader();
      try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>2*1024*1024)throw new Error('Image response too large');chunks.push(part.value);}}
      finally {await reader.cancel().catch(()=>{});}
      if(!item.listeners.size||item.controller.signal.aborted)return;
      const blob=new Blob(chunks,{type:'image/webp'});item.url=makeURL(blob);item.bytes=size;bytes+=size;item.state='ready';item.until=now()+300000;
      for(const listener of item.listeners.values())listener.onReady?.(item.url);
    } catch(error) {
      if(!item.listeners.size)return;
      if((error.retryable||error.name==='TypeError'||error.name==='TimeoutError')&&item.attempts<3) {
        item.state='queued';item.at=now()+(error.delay||1000*2**(item.attempts-1));queue.push(item);
      } else {item.state='failed';item.until=now()+30000;for(const listener of item.listeners.values())listener.onError?.();}
    } finally {
      if(!item.listeners.size&&entries.get(item.src)===item){entries.delete(item.src);if(item.url){revokeURL(item.url);bytes-=item.bytes;}}
    }
  }
  return {
    subscribe(src,{priority=0,onReady,onError}={}) {
      if(!allowed(src)){queueMicrotask(()=>onError?.());return()=>{};}
      prune();let item=entries.get(src);
      if(!item) {
        if(queue.length>=96){queueMicrotask(()=>onError?.());return()=>{};}
        item={src,state:'queued',listeners:new Map(),priority,created:now(),at:now(),until:Infinity,attempts:0,bytes:0};entries.set(src,item);queue.push(item);
      }
      const id=Symbol();item.listeners.set(id,{onReady,onError});item.priority=Math.max(item.priority,priority);
      if(item.state==='ready')onReady?.(item.url);else if(item.state==='failed')onError?.();else pump();
      return()=>{
        item.listeners.delete(id);
        if(!item.listeners.size&&item.state!=='ready'&&item.state!=='failed') {
          const at=queue.indexOf(item);if(at>=0)queue.splice(at,1);item.controller?.abort();if(entries.get(src)===item)entries.delete(src);
        }
        prune();if(!queue.length&&timer){clearTimeout(timer);timer=null;}
      };
    },
  };
}
export const imageLoader=createImageLoader();
