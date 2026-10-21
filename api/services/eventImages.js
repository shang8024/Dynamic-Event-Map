const https=require('node:https');
const dns=require('node:dns/promises');
const {createHash}=require('node:crypto');
const ipaddr=require('ipaddr.js');
const {ImageError}=require('./imageErrors');
const ALLOWED_HOSTS=new Set(['secure.toronto.ca','images.unsplash.com','i.imgur.com','res.cloudinary.com','images.pexels.com']);
const MAX_BYTES=8*1024*1024,MAX_PIXELS=12000000;
const MIME_TYPES=new Set(['image/jpeg','image/png','image/webp','image/avif']);

function validateImageURL(value) {
  if(typeof value!=='string' || value.length>4000 || /[\x00-\x20\\]/.test(value)) throw new ImageError('IMAGE_URL_INVALID');
  let url;try {url=new URL(value);} catch {throw new ImageError('IMAGE_URL_INVALID');}
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || url.hash) throw new ImageError('IMAGE_URL_INVALID');
  if(!ALLOWED_HOSTS.has(url.hostname)) throw new ImageError('IMAGE_HOST_NOT_ALLOWED');
  if(url.hostname==='secure.toronto.ca' && !/^\/c3api_upload\/retrieve\/festivals_events\/[A-Za-z0-9_-]{10,100}$/.test(url.pathname)) throw new ImageError('IMAGE_URL_INVALID');
  return url;
}
function isPublicAddress(address) {
  try {return ipaddr.process(address).range()==='unicast';} catch {return false;}
}
async function resolvePublic(hostname,lookup=dns.lookup) {
  let addresses;try {addresses=await lookup(hostname,{all:true,verbatim:true});} catch {throw new ImageError('IMAGE_UNREACHABLE');}
  if(!addresses.length || addresses.some(item=>!isPublicAddress(item.address))) throw new ImageError('IMAGE_ADDRESS_BLOCKED');
  return addresses;
}
async function downloadImage(value,{lookup=dns.lookup,request=https.request}={}) {
  const signal=AbortSignal.timeout(10000);
  async function fetchHop(value,hops) {
    const url=validateImageURL(value);
    const addresses=await Promise.race([resolvePublic(url.hostname,lookup),new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new ImageError('IMAGE_TIMEOUT')),{once:true}))]);
    signal.throwIfAborted();
    const result=await new Promise((resolve,reject)=>{
      const req=request(url,{agent:false,signal,maxHeaderSize:16384,headers:{Accept:[...MIME_TYPES].join(','),'Accept-Encoding':'identity','User-Agent':'Dynamic-Event-Map image proxy'},
        lookup:(_host,options,callback)=>options.all?callback(null,addresses):callback(null,addresses[0].address,addresses[0].family)},response=>{
        if([301,302,303,307,308].includes(response.statusCode)) {response.destroy();return resolve({redirect:response.headers.location});}
        const type=String(response.headers['content-type']||'').split(';')[0].toLowerCase();
        const rejection=response.statusCode!==200?'IMAGE_UNREACHABLE':Number(response.headers['content-length'])>MAX_BYTES?'IMAGE_TOO_LARGE':
          !MIME_TYPES.has(type)||![undefined,'identity'].includes(response.headers['content-encoding'])?'IMAGE_FORMAT_UNSUPPORTED':null;
        if(rejection) {response.destroy();return reject(new ImageError(rejection));}
        const chunks=[];let bytes=0;
        response.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_BYTES) {response.destroy();reject(new ImageError('IMAGE_TOO_LARGE'));} else chunks.push(chunk);});
        response.on('error',reject);response.on('end',()=>resolve({bytes:Buffer.concat(chunks)}));
      });
      req.on('error',reject);req.end();
    });
    if(result.redirect) {
      if(hops>=2) throw new ImageError('IMAGE_REDIRECT_REJECTED');
      // Each hop has the same host allowlist, public-DNS and pinned-address checks.
      return fetchHop(new URL(result.redirect,url).href,hops+1);
    }
    return result.bytes;
  }
  try {return await fetchHop(value,0);} catch(error) {
    if(error instanceof ImageError) throw error;
    throw new ImageError(signal.aborted?'IMAGE_TIMEOUT':'IMAGE_UNREACHABLE');
  }
}
async function sanitizeImage(bytes,size='detail') {
  const sharp=require('sharp');
  sharp.cache({memory:8,files:0,items:16});sharp.concurrency(1);
  if(!Buffer.isBuffer(bytes)) throw new ImageError('IMAGE_INVALID');
  if(bytes.length>MAX_BYTES) throw new ImageError('IMAGE_TOO_LARGE');
  const isRaster=bytes.subarray(0,3).equals(Buffer.from([0xff,0xd8,0xff])) ||
    bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) ||
    (bytes.toString('ascii',0,4)==='RIFF' && bytes.toString('ascii',8,12)==='WEBP') ||
    (bytes.toString('ascii',4,8)==='ftyp' && /avif|avis/.test(bytes.toString('ascii',8,32)));
  if(!isRaster) throw new ImageError('IMAGE_FORMAT_UNSUPPORTED');
  try {
    const metadata=await sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'warning'}).metadata();
    if(!['jpeg','png','webp','avif','heif'].includes(metadata.format) || (metadata.pages||1)>1) throw new ImageError('IMAGE_FORMAT_UNSUPPORTED');
    return await sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'warning'}).rotate().resize({width:size==='thumb'?128:1100,height:size==='thumb'?128:900,fit:size==='thumb'?'cover':'inside',withoutEnlargement:true})
      .webp({quality:size==='thumb'?75:80}).timeout({seconds:4}).toBuffer();
  } catch(error) {
    if(error instanceof ImageError) throw error;
    throw new ImageError(/pixel limit/i.test(error.message)?'IMAGE_TOO_LARGE':/timeout/i.test(error.message)?'IMAGE_TIMEOUT':'IMAGE_INVALID');
  }
}
const cache=new Map(),inflight=new Map();let cacheBytes=0,active=0;
const queue=[];
const eviction=setInterval(()=>{for(const [key,value] of cache) if(value.until<=Date.now()) {cache.delete(key);cacheBytes-=value.bytes.length;}},60000);eviction.unref();
async function slot() {
  if(active<1) {active++;return;}
  if(queue.length>=30) throw new ImageError('IMAGE_BUSY');
  await new Promise((resolve,reject)=>{
    const item={resolve:()=>{clearTimeout(item.timer);resolve();},timer:null};
    item.timer=setTimeout(()=>{const index=queue.indexOf(item);if(index>=0) queue.splice(index,1);reject(new ImageError('IMAGE_BUSY'));},12000);
    queue.push(item);
  });
}
function release() {const next=queue.shift();if(next) next.resolve();else active--;}
async function getImage(url,size) {
  validateImageURL(url);
  if(process.env.IMAGE_PROXY_URL) {
    let response;
    try {response=await fetch(`${process.env.IMAGE_PROXY_URL}/render`,{method:'POST',
      headers:{'Content-Type':'application/json'},body:JSON.stringify({url,size}),redirect:'error',signal:AbortSignal.timeout(16000)});}
    catch(error) {throw new ImageError(error.name==='TimeoutError'?'IMAGE_TIMEOUT':'IMAGE_SERVICE_UNAVAILABLE');}
    if(!response.ok) {
      if(Number(response.headers.get('content-length'))>2000) {await response.body?.cancel();throw new ImageError('IMAGE_SERVICE_UNAVAILABLE');}
      const result=await response.json().catch(()=>({}));throw new ImageError(result.code||'IMAGE_SERVICE_UNAVAILABLE');
    }
    if(response.headers.get('content-type')!=='image/webp') {await response.body?.cancel();throw new ImageError('IMAGE_SERVICE_UNAVAILABLE');}
    const chunks=[];let bytes=0;
    for await(const chunk of response.body) {bytes+=chunk.length;if(bytes>2*1024*1024) throw new ImageError('IMAGE_TOO_LARGE');chunks.push(chunk);}
    return Buffer.concat(chunks);
  }
  if(process.env.NODE_ENV==='production' && process.env.IMAGE_PROXY_WORKER!=='true') throw new ImageError('IMAGE_SERVICE_UNAVAILABLE');
  const key=createHash('sha256').update(`${size}:${url}`).digest('hex');
  const cached=cache.get(key);
  if(cached && cached.until>Date.now()) return cached.bytes;
  if(cached) {cache.delete(key);cacheBytes-=cached.bytes.length;}
  if(inflight.has(key)) return inflight.get(key);
  const promise=(async()=>{
    await slot();
    try {
      const bytes=await sanitizeImage(await downloadImage(url),size);
      while(cacheBytes+bytes.length>20*1024*1024 && cache.size) {const [old,item]=cache.entries().next().value;cache.delete(old);cacheBytes-=item.bytes.length;}
      cache.set(key,{bytes,until:Date.now()+3600000});cacheBytes+=bytes.length;return bytes;
    } finally {release();}
  })().finally(()=>inflight.delete(key));
  inflight.set(key,promise);return promise;
}
function sourceImage(event) {
  if(event.data?.image_hidden || (event.ends_at && new Date(event.ends_at)<new Date()) || event.status==='cancelled') return null;
  return event.data?.image || event.data?.imported_image || null;
}
module.exports={ALLOWED_HOSTS,validateImageURL,isPublicAddress,resolvePublic,downloadImage,sanitizeImage,getImage,sourceImage};
