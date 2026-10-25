const {createHash}=require('node:crypto');

const COUNTER_SCRIPT=`local n=redis.call('INCR',KEYS[1])
if n==1 then redis.call('PEXPIRE',KEYS[1],ARGV[1]) end
return {n,redis.call('PTTL',KEYS[1])}`;

function bounded(promise,milliseconds=1500) {
  let timer;
  return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Dependency timeout')),milliseconds);})])
    .finally(()=>clearTimeout(timer));
}
function canonicalPath(req) {
  const raw=(req.originalUrl || req.url || '').split('?')[0];
  // Express decodes route parameters once, including an encoded event ID.
  let path;try {path=decodeURIComponent(raw);} catch {path=raw;}
  return path.toLowerCase().replace(/\/+$/,'');
}
function requestPolicy(req,authenticated) {
  const pathname=canonicalPath(req),read=['GET','HEAD'].includes(req.method);
  if(read && pathname==='/api/healthz') return null;
  if(pathname==='/api/readyz') return {bucket:'probe',limit:60,window:60000};
  if(pathname==='/api/notifications/feedback/ses') return {bucket:'feedback',limit:300,window:60000};
  if(pathname==='/api/notifications/unsubscribe') return authenticated?null:{bucket:'unsubscribe',limit:30,window:300000};
  if(read && /^\/api\/events\/\d+\/image$/.test(pathname)) return {bucket:'image',limit:120,window:60000};
  if(/^\/api\/(auth|profiles)(\/|$)/.test(pathname)) return {bucket:'auth',limit:authenticated?120:600,window:300000};
  if(['POST','PUT','PATCH','DELETE'].includes(req.method)) return {bucket:'write',limit:authenticated?30:300,window:60000};
  if(read && !authenticated && ['/api/events','/api/events/map'].includes(pathname)) return {bucket:'catalogue',limit:30,window:60000};
  if(read && !authenticated && /^\/api\/events\/\d+\/comments(?:\/snapshot)?$/.test(pathname)) return {bucket:'discussion',limit:60,window:60000};
  if(read) return {bucket:'read',limit:authenticated?180:300,window:60000};
  return null;
}
function requestPolicies(req,authenticated) {
  const first=requestPolicy(req,authenticated);
  if(!first) return [];
  const policies=[first];
  if(authenticated && ['POST','PUT','PATCH','DELETE'].includes(req.method)) {
    policies.push({bucket:'write-day',limit:500,window:86400000});
    const pathname=canonicalPath(req);
    if(req.method==='POST' && pathname==='/api/events') policies.push({bucket:'event-create-day',limit:10,window:86400000});
    if(req.method==='POST' && /^\/api\/events\/\d+\/suggestions$/.test(pathname)) {
      policies.push({bucket:'suggestion-burst',limit:3,window:600000},{bucket:'suggestion-day',limit:20,window:86400000});
    }
    if(req.method==='POST' && pathname==='/api/event-photo-preview') policies.push({bucket:'photo-preview',limit:20,window:3600000});
    if(req.method==='POST' && /^\/api\/events\/\d+\/comments$/.test(pathname)) policies.push({bucket:'comment-day',limit:100,window:86400000});
  }
  return policies;
}
function createAdmissionGuard({maximum=32,catalogue=4,discussion=4,image=8}={}) {
  let active=0;const buckets=new Map();
  return function admit(req,res) {
    const policy=requestPolicy(req,false);
    if(!policy || typeof res.once!=='function') return true;
    const cap={catalogue,discussion,image}[policy.bucket]||maximum,count=buckets.get(policy.bucket)||0;
    if(active>=maximum || count>=cap) {
      res.set('Retry-After','1');res.status(503).json({message:'The service is busy. Please try again shortly.'});return false;
    }
    active++;buckets.set(policy.bucket,count+1);let released=false;
    const release=()=>{if(released) return;released=true;active--;buckets.set(policy.bucket,buckets.get(policy.bucket)-1);};
    res.once('finish',release);res.once('close',release);return true;
  };
}
function createRequestLimits(redis,{timeoutMs=1500,prefix='rate:v1'}={}) {
  const admit=createAdmissionGuard();
  async function enforce(req,res,identity,authenticated) {
    const policies=requestPolicies(req,authenticated);
    if(!policies.length) return true;
    const hash=createHash('sha256').update(String(identity)).digest('hex');
    try {
      if(!redis.isReady) throw new Error('Rate-limit store unavailable');
      for(const policy of policies) {
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
      }
      return true;
    } catch {
      // Guarded API traffic never continues without the distributed abuse guard.
      res.set('Retry-After','5');res.status(503).json({message:'Please try again shortly.'});return false;
    }
  }
  return {
    anonymous:async(req,res,next)=>{if(admit(req,res) && await enforce(req,res,req.ip || req.socket?.remoteAddress || 'unknown',false)) next();},
    authenticated:(req,res,uid)=>enforce(req,res,uid,true),
  };
}
module.exports={COUNTER_SCRIPT,bounded,canonicalPath,requestPolicy,requestPolicies,createAdmissionGuard,createRequestLimits};
