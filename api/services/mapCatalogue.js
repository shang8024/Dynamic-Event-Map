const {createHash}=require('node:crypto');
const {publicEvent}=require('./publicEvents');

// Small bounded snapshots retain their ETag across time buckets when the data
// is unchanged. The clock bucket also advances ongoing/next occurrence dates.
function createMapCatalogue(model,{now=Date.now,maximum=12}={}) {
  const snapshots=new Map();
  return async function catalogue(req,res) {
    const query=typeof req.query?.q==='string'?req.query.q.trim().toLowerCase():'';
    if(query.length>200) return res.status(400).json({error:'Search must be 200 characters or fewer.'});
    try {
      const revision=JSON.stringify((await model.getMapRevision()).rows[0]);
      const key=JSON.stringify([query,revision,Math.floor(now()/15000)]);
      let pending=snapshots.get(key);
      if(!pending) {
        pending=model.getMap(query).then(({rows})=>{
          const body=JSON.stringify(rows.map(row=>({...publicEvent(row),_summary:true})));
          return {body,etag:`"${createHash('sha256').update(body).digest('base64url')}"`};
        }).catch(error=>{snapshots.delete(key);throw error;});
        snapshots.set(key,pending);
        while(snapshots.size>maximum) snapshots.delete(snapshots.keys().next().value);
      }
      const {body,etag}=await pending;
      res.set('Cache-Control','private, no-cache');res.set('ETag',etag);
      if(req.get('If-None-Match')?.split(',').map(value=>value.trim().replace(/^W\//,'')).includes(etag)) return res.status(304).end();
      res.type('json').send(body);
    } catch {res.status(503).json({error:'Unable to load events. Please try again.'});}
  };
}
module.exports={createMapCatalogue};
