const {createHash}=require('node:crypto');

const COUNTER_SCRIPT=`local n=redis.call('INCR',KEYS[1])
if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end
return {n,redis.call('PTTL',KEYS[1])}`;

function bounded(promise,milliseconds=1500) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Dependency timeout')),milliseconds);})])
    .finally(()=>clearTimeout(timer));
}
function requestPolicy(req,authenticated) {
  // Match Express's default case-insensitive, non-strict routing semantics.
  const pathname=(req.originalUrl || req.url || '').split('?')[0].toLowerCase().replace(/\/+$/,'');
  if(pathname==='/api/notifications/feedback/ses' || /^\/api\/(healthz|readyz)$/.test(pathname)) return null;
  if(pathname==='/api/notifications/unsubscribe') return authenticated?null:{bucket:'unsubscribe',limit:30,window:300000};
  if(/^\/api\/(auth|profiles)(\/|$)/.test(pathname)) return {bucket:'auth',limit:authenticated?120:600,window:300000};
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)) return {bucket:'write',limit:authenticated?30:300,window:60000};
  return null;
}
function createRequestLimits(redis,{timeoutMs=1500,prefix='rate:v1'}={}) {
  async function enforce(req,res,identity,authenticated) {
    const policy=requestPolicy(req,authenticated);
    if(!policy) return true;
    const hash=createHash('sha256').update(String(identity)).digest('hex');
    try {
      if(!redis.isReady) throw new Error('Rate-limit store unavailable');
      const [count,ttl]=await bounded(redis.eval(COUNTER_SCRIPT,{keys:[`${prefix}:${authenticated?'uid':'ip'}:${hash}:${policy.bucket}`],
        arguments:[String(policy.window)]}),timeoutMs);
      const retry=Math.max(1,Math.ceil(Number(ttl)/1000));
      res.set('RateLimit-Limit',String(policy.limit));
      res.set('RateLimit-Remaining',String(Math.max(0,policy.limit-Number(count))));
      res.set('RateLimit-Reset',String(retry));
      if(Number(count)>policy.limit) {
        res.set('Retry-After',String(retry));
        res.status(429).json({message:'Too many requests. Please wait and try again.'});return false;
      }
      return true;
    } catch {
      // Protected writes never continue without the distributed abuse guard.
      res.set('Retry-After','5');res.status(503).json({message:'Please try again shortly.'});return false;
    }
  }
  return {
    anonymous:async(req,res,next)=>{if(await enforce(req,res,req.ip || req.socket?.remoteAddress || 'unknown',false)) next();},
    authenticated:(req,res,uid)=>enforce(req,res,uid,true),
  };
}
module.exports={COUNTER_SCRIPT,bounded,requestPolicy,createRequestLimits};
