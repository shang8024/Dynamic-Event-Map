const {bounded}=require('./requestLimits');

function createReadiness({db,redis,timeoutMs=2000,cacheMs=1000,realtime,imageProxyURL}) {
  let inFlight=null,cached=null,cachedUntil=0;
  async function probe() {
    if(cached && Date.now()<cachedUntil) return cached;
    if(inFlight) return inFlight;
    inFlight=(async()=>{
      const checks=await Promise.allSettled([
        bounded(Promise.resolve().then(()=>db.query({text:'SELECT 1',query_timeout:1500})),timeoutMs),
        redis.isReady?bounded(Promise.resolve().then(()=>redis.ping()),timeoutMs):Promise.reject(new Error('Redis not ready')),
        ...(imageProxyURL?[fetch(`${imageProxyURL}/healthz`,{signal:AbortSignal.timeout(timeoutMs),redirect:'error'}).then(async response=>{
          if(!response.ok || (await response.json()).status!=='ok') throw new Error('Image worker not ready');
        })]:[]),
      ]);
      const realtimeReady=!realtime || realtime.isReady();
      cached={ready:realtimeReady && checks.every(result=>result.status==='fulfilled'),
        dependencies:{database:checks[0].status==='fulfilled'?'ready':'unavailable',redis:checks[1].status==='fulfilled'?'ready':'unavailable',...(realtime?{realtime:realtimeReady?'ready':'unavailable'}:{}),...(imageProxyURL?{images:checks[2].status==='fulfilled'?'ready':'unavailable'}:{})}};
      cachedUntil=Date.now()+cacheMs;return cached;
    })().finally(()=>{inFlight=null;});
    return inFlight;
  }
  return async(_req,res)=>{
    res.set('Cache-Control','no-store');
    const result=await probe();res.status(result.ready?200:503).json(result);
  };
}
module.exports={createReadiness};
