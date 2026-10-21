const https=require('node:https');
const dns=require('node:dns/promises');
const {createHash}=require('node:crypto');
const ipaddr=require('ipaddr.js');
const sharp=require('sharp');
sharp.cache({memory:8,files:0,items:16});sharp.concurrency(1);
const ALLOWED_HOSTS=new Set(['secure.toronto.ca','images.unsplash.com','i.imgur.com','res.cloudinary.com','images.pexels.com']);
const MAX_BYTES=8*1024*1024,MAX_PIXELS=12000000;
const MIME_TYPES=new Set(['image/jpeg','image/png','image/webp','image/avif']);

function validateImageURL(value) {
  if(typeof value!=='string' || value.length>4000 || /[\x00-\x20\\]/.test(value)) throw new Error('Use a public HTTPS image URL from a supported image host.');
  const url=new URL(value);
  if(url.protocol!=='https:' || url.username || url.password || (url.port && url.port!=='443') || url.hash || !ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error('Supported image hosts: Toronto, Unsplash, Imgur, Cloudinary and Pexels. Use a direct HTTPS image link.');
  }
  if(url.hostname==='secure.toronto.ca' && !/^\/c3api_upload\/retrieve\/festivals_events\/[A-Za-z0-9_-]{10,100}$/.test(url.pathname)) throw new Error('Use an official Toronto event image link.');
  return url;
}
function isPublicAddress(address) {
  try {return ipaddr.process(address).range()==='unicast';} catch {return false;}
}
async function resolvePublic(hostname,lookup=dns.lookup) {
  const addresses=await lookup(hostname,{all:true,verbatim:true});
  if(!addresses.length || addresses.some(item=>!isPublicAddress(item.address))) throw new Error('Image address is not public');
  return addresses;
}
async function downloadImage(value,{lookup=dns.lookup,request=https.request}={}) {
  const signal=AbortSignal.timeout(10000);
  async function fetchHop(value,hops) {
    const url=validateImageURL(value);
    const addresses=await Promise.race([resolvePublic(url.hostname,lookup),new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('Image lookup timed out')),{once:true}))]);
    signal.throwIfAborted();
    const result=await new Promise((resolve,reject)=>{
      const req=request(url,{agent:false,signal,maxHeaderSize:16384,headers:{Accept:[...MIME_TYPES].join(','),'Accept-Encoding':'identity','User-Agent':'Dynamic-Event-Map image proxy'},
        lookup:(_host,options,callback)=>options.all?callback(null,addresses):callback(null,addresses[0].address,addresses[0].family)},response=>{
        if([301,302,303,307,308].includes(response.statusCode)) {response.destroy();return resolve({redirect:response.headers.location});}
        const type=String(response.headers['content-type']||'').split(';')[0].toLowerCase();
        if(response.statusCode!==200 || !MIME_TYPES.has(type) || Number(response.headers['content-length'])>MAX_BYTES || ![undefined,'identity'].includes(response.headers['content-encoding'])) {
          response.destroy();return reject(new Error('The link did not return an allowed image'));
        }
        const chunks=[];let bytes=0;
        response.on('data',chunk=>{bytes+=chunk.length;if(bytes>MAX_BYTES) {response.destroy();reject(new Error('Image is too large'));} else chunks.push(chunk);});
        response.on('error',reject);response.on('end',()=>resolve({bytes:Buffer.concat(chunks)}));
      });
      req.on('error',reject);req.end();
    });
    if(result.redirect) {
      if(hops>=2) throw new Error('Too many image redirects');
      // Each hop has the same host allowlist, public-DNS and pinned-address checks.
      return fetchHop(new URL(result.redirect,url).href,hops+1);
    }
    return result.bytes;
  }
  return fetchHop(value,0);
}
async function sanitizeImage(bytes,size='detail') {
  if(!Buffer.isBuffer(bytes) || bytes.length>MAX_BYTES) throw new Error('Invalid image size');
  const metadata=await sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'warning'}).metadata();
  if(!['jpeg','png','webp','avif','heif'].includes(metadata.format) || (metadata.pages||1)>1) throw new Error('Use a still JPEG, PNG, WebP or AVIF image');
  return sharp(bytes,{limitInputPixels:MAX_PIXELS,failOn:'warning'}).rotate().resize({width:size==='thumb'?128:1100,height:size==='thumb'?128:900,fit:size==='thumb'?'cover':'inside',withoutEnlargement:true})
    .webp({quality:size==='thumb'?75:80}).timeout({seconds:4}).toBuffer();
}
const cache=new Map(),inflight=new Map();let cacheBytes=0,active=0;
const queue=[];
async function slot() {
  if(active<1) {active++;return;}
  if(queue.length>=30) throw new Error('Image service is busy');
  await new Promise((resolve,reject)=>{
    const item={resolve:()=>{clearTimeout(item.timer);resolve();},timer:null};
    item.timer=setTimeout(()=>{const index=queue.indexOf(item);if(index>=0) queue.splice(index,1);reject(new Error('Image service is busy'));},12000);
    queue.push(item);
  });
}
function release() {const next=queue.shift();if(next) next.resolve();else active--;}
async function getImage(url,size) {
  validateImageURL(url);
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
