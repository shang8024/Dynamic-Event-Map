const {createHash,randomUUID}=require('node:crypto');
const proxyAddress=require('proxy-addr');
const {createProxyTrust}=require('./proxyTrust');
const {bounded,COUNTER_SCRIPT}=require('./requestLimits');

const ACQUIRE=`local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
local n=redis.call('INCR',KEYS[3]); if n==1 then redis.call('PEXPIRE',KEYS[3],60000) end
if n>tonumber(ARGV[5]) then return 0 end
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now); redis.call('ZREMRANGEBYSCORE',KEYS[2],'-inf',now)
if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[3]) or redis.call('ZCARD',KEYS[2])>=tonumber(ARGV[4]) then return 0 end
for i=1,2 do redis.call('ZADD',KEYS[i],now+tonumber(ARGV[2]),ARGV[1]); redis.call('PEXPIRE',KEYS[i],tonumber(ARGV[2])*2) end
return 1`;
const BIND=`local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
redis.call('ZREMRANGEBYSCORE',KEYS[1],'-inf',now)
if redis.call('ZCARD',KEYS[1])>=tonumber(ARGV[3]) and not redis.call('ZSCORE',KEYS[1],ARGV[1]) then return 0 end
redis.call('ZADD',KEYS[1],now+tonumber(ARGV[2]),ARGV[1]); redis.call('PEXPIRE',KEYS[1],tonumber(ARGV[2])*2); return 1`;
const RENEW=`local t=redis.call('TIME'); local now=t[1]*1000+math.floor(t[2]/1000)
for _,key in ipairs(KEYS) do local score=redis.call('ZSCORE',key,ARGV[1]); if not score or tonumber(score)<=now then return 0 end end
for _,key in ipairs(KEYS) do redis.call('ZADD',key,now+tonumber(ARGV[2]),ARGV[1]); redis.call('PEXPIRE',key,tonumber(ARGV[2])*2) end; return 1`;
const RELEASE=`for _,key in ipairs(KEYS) do redis.call('ZREM',key,ARGV[1]) end; return 1`;
const hash=value=>createHash('sha256').update(String(value)).digest('hex');

function createSocketAdmission(redis,{prefix='socket:admission:v1',trustedProxyCIDRs=process.env.TRUSTED_PROXY_CIDRS,
  perIP=20,perUser=8,globalMaximum=200,localMaximum=100,attemptsPerMinute=120,joinsPerMinute=120,
  leaseMs=70000,heartbeatMs=20000,handshakeTimeoutMs=10000,timeoutMs=1000}={}) {
  const trust=createProxyTrust(trustedProxyCIDRs)||(()=>false),leases=new Map();let pending=0,stopped=false,renewing=false;
  const allKey=`${prefix}:active`;
  async function evaluate(script,keys,args) {
    if(stopped || !redis.isReady) throw new Error('Realtime admission unavailable');
    return bounded(redis.eval(script,{keys,arguments:args.map(String)}),timeoutMs);
  }
  async function release(lease) {
    if(!lease || lease.closed) return;
    lease.closed=true;leases.delete(lease.token);
    if(redis.isReady) try {await bounded(redis.eval(RELEASE,{keys:lease.keys,arguments:[lease.token]}),timeoutMs);} catch {/* Leases also expire after a crashed replica. */}
  }
  async function acquire(req) {
    if(stopped || leases.size+pending>=localMaximum) return null;
    pending++;
    try {
      const ipHash=hash(proxyAddress(req,trust)),token=randomUUID(),ipKey=`${prefix}:ip:${ipHash}`;
      const accepted=await evaluate(ACQUIRE,[ipKey,allKey,`${prefix}:attempt:${ipHash}`],[token,leaseMs,perIP,globalMaximum,attemptsPerMinute]);
      if(Number(accepted)!==1) return null;
      const lease={token,ipHash,keys:[ipKey,allKey],acquiredAt:Date.now(),closed:false};leases.set(token,lease);return lease;
    } catch {return null;} finally {pending--;}
  }
  async function bindUser(lease,userId) {
    if(!lease || lease.closed) return false;
    const key=`${prefix}:uid:${hash(userId)}`;
    // Include the UID in cleanup before awaiting Redis: a client can disconnect
    // while its binding command is still in flight.
    if(!lease.keys.includes(key)) lease.keys.push(key);
    try {
      if(Number(await evaluate(BIND,[key],[lease.token,leaseMs,perUser]))!==1) return false;
      return !lease.closed;
    } catch {return false;}
  }
  async function allowJoin(lease) {
    if(!lease || lease.closed) return false;
    try {
      const [count]=await evaluate(COUNTER_SCRIPT,[`${prefix}:join:${lease.ipHash}`],[60000]);
      return Number(count)<=joinsPerMinute;
    } catch {return false;}
  }
  function attach(connection) {
    const lease=connection.request.eventmapAdmission;
    if(!lease || lease.closed) {connection.close(true);return;}
    lease.connection=connection;
    connection.once('close',()=>{void release(lease);});
  }
  async function renew() {
    if(renewing || stopped) return;
    renewing=true;
    try {await Promise.all([...leases.values()].map(async lease=>{
      // Failed/abandoned upgrades may never emit Engine.IO's connection event.
      // Never extend such a reservation; otherwise malformed handshakes can
      // permanently consume every live-connection slot.
      if(!lease.connection) {
        if(Date.now()-lease.acquiredAt>=handshakeTimeoutMs) await release(lease);
        return;
      }
      try {
        if(Number(await evaluate(RENEW,lease.keys,[lease.token,leaseMs]))===1 && (!lease.revalidate || await lease.revalidate())) return;
      } catch {/* Stop unguarded or revoked connections promptly. */}
      lease.connection?.close(true);await release(lease);
    }));} finally {renewing=false;}
  }
  const timer=setInterval(()=>{void renew();},heartbeatMs);timer.unref();
  async function close() {clearInterval(timer);stopped=true;await Promise.all([...leases.values()].map(release));}
  return {acquire,bindUser,allowJoin,attach,release,renew,close};
}
module.exports={createSocketAdmission};
