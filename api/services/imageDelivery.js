const images=require('./eventImages');
const {createThumbnailCache}=require('./thumbnailCache');

function createImageDelivery({cache,getImage=images.getImage}) {
  const inflight=new Map();
  return async function getDeliveredImage(url,size,{expiresAt,revision='1'}={}) {
    images.validateImageURL(url);
    if(size!=='thumb') return getImage(url,size);
    const key=`${revision}:${url}`;
    if(inflight.has(key)) return inflight.get(key);
    const promise=(async()=>{
      const cached=await cache.get(key);if(cached)return cached;
      const bytes=await getImage(url,'thumb');
      const ttl=expiresAt?Math.min(21600,(new Date(expiresAt).getTime()-Date.now())/1000):21600;
      if(ttl>0)await cache.set(key,bytes,ttl);
      return bytes;
    })().finally(()=>inflight.delete(key));
    inflight.set(key,promise);return promise;
  };
}
// The API owns Redis access; the isolated decoder receives no Redis credentials.
let delivery;
module.exports={createImageDelivery,getDeliveredImage(...args){
  delivery??=createImageDelivery({cache:createThumbnailCache(require('../config/redis'))});
  return delivery(...args);
}};
