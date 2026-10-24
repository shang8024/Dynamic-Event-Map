const {createHash}=require('node:crypto');
const WRITE=`
local data,sizes,order,total,sequence=KEYS[1],KEYS[2],KEYS[3],KEYS[4],KEYS[5]
local bytes=string.len(ARGV[1]);local cap=tonumber(ARGV[3]);local limit=tonumber(ARGV[4])
if bytes>tonumber(ARGV[5]) or bytes>cap then return 0 end
local used=tonumber(redis.call('GET',total) or '0')-tonumber(redis.call('HGET',sizes,data) or '0')
redis.call('HDEL',sizes,data);redis.call('ZREM',order,data)
for i=1,512 do
 if used+bytes<=cap and redis.call('ZCARD',order)<limit then break end
 local first=redis.call('ZRANGE',order,0,0)[1];if not first then break end
 used=used-tonumber(redis.call('HGET',sizes,first) or '0')
 redis.call('DEL',first);redis.call('HDEL',sizes,first);redis.call('ZREM',order,first)
end
redis.call('SET',data,ARGV[1],'EX',ARGV[2]);redis.call('HSET',sizes,data,bytes)
redis.call('ZADD',order,redis.call('INCR',sequence),data);redis.call('SET',total,math.max(0,used)+bytes)
for _,key in ipairs({sizes,order,total,sequence}) do redis.call('EXPIRE',key,21660) end
return 1`;
const bounded=promise=>{let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Cache deadline')),300);})]).finally(()=>clearTimeout(timer));};
function isWebP(value){return Buffer.isBuffer(value)&&value.length>=12&&value.toString('ascii',0,4)==='RIFF'&&value.toString('ascii',8,12)==='WEBP';}
function createThumbnailCache(redis,{prefix='image:thumb:v2',maximumBytes=2*1024*1024,maximumEntries=512,maximumEntry=128*1024}={}) {
  let checkedAt=0,hasRoom=false;
  const key=url=>`${prefix}:${createHash('sha256').update(url).digest('hex')}`;
  return {
    async get(url) {
      if(!redis.isReady) return null;
      try {const value=await bounded(redis.get(key(url)));if(!value||value.length>maximumEntry)return null;
        const bytes=Buffer.from(value,'base64');return isWebP(bytes)?bytes:null;
      } catch {return null;}
    },
    async set(url,bytes,ttl=21600) {
      if(!redis.isReady||!isWebP(bytes)) return;
      const encoded=bytes.toString('base64');if(encoded.length>maximumEntry) return;
      try {
        if(Date.now()-checkedAt>1000) {
          const info=await bounded(redis.info('memory'));
          const used=Number(info.match(/(?:^|\n)used_memory:(\d+)/)?.[1]),max=Number(info.match(/(?:^|\n)maxmemory:(\d+)/)?.[1]);
          hasRoom=Number.isFinite(used)&&Number.isFinite(max)&&(max===0||max-used>16*1024*1024);checkedAt=Date.now();
        }
        if(!hasRoom) return;
        await bounded(redis.eval(WRITE,{keys:[key(url),prefix+':sizes',prefix+':order',prefix+':bytes',prefix+':sequence'],
          arguments:[encoded,String(Math.max(1,Math.min(21600,Math.floor(ttl)))),String(maximumBytes),String(maximumEntries),String(maximumEntry)]}));
      } catch { /* Optional image caching must not turn a valid image into an error. */ }
    },
  };
}
module.exports={createThumbnailCache,isWebP};
