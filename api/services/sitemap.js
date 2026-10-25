const {createHash}=require('node:crypto');
const {bounded}=require('./requestLimits');

const ORIGIN='https://www.dynamic-event-map.cloud';
const MAX_EVENTS=49999; // One of the protocol's 50,000 URL slots is the homepage.
const SITEMAP_QUERY=`SELECT id,updated_at,ends_at FROM events
  WHERE archived_at IS NULL AND status='scheduled' AND (ends_at IS NULL OR ends_at>now())
  ORDER BY id LIMIT 50000`;
const xml=value=>String(value).replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));

function sitemapDocument(rows,now=Date.now()) {
  if(rows.length>MAX_EVENTS) throw new Error('Sitemap requires pagination');
  const entries=[`  <url><loc>${ORIGIN}/</loc></url>`];
  for(const row of rows) {
    const id=String(row.id);
    if(!/^[1-9]\d{0,9}$/.test(id)||Number(id)>2147483647) throw new Error('Invalid sitemap event ID');
    // Known final end times exclude an event; an absent end is never guessed.
    if(row.ends_at&&Date.parse(row.ends_at)<=now) continue;
    const modified=row.updated_at?new Date(row.updated_at):null;
    const lastmod=modified&&Number.isFinite(+modified)&&+modified<=now?`<lastmod>${xml(modified.toISOString())}</lastmod>`:'';
    entries.push(`  <url><loc>${xml(`${ORIGIN}/events/${id}`)}</loc>${lastmod}</url>`);
  }
  const body=`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  if(Buffer.byteLength(body)>50*1024*1024) throw new Error('Sitemap exceeds protocol size limit');
  return body;
}

function createSitemap({db,now=Date.now,cacheMs=60000}) {
  let cached=null,inFlight=null;
  async function snapshot() {
    if(cached&&cached.until>now()) return cached;
    if(inFlight) return inFlight;
    inFlight=(async()=>{
      const {rows}=await bounded(db.query({text:SITEMAP_QUERY,query_timeout:3000}),5000);
      const at=now(),body=sitemapDocument(rows,at);
      // Refresh at the next known expiry even when it falls inside the cache TTL.
      const until=rows.reduce((end,row)=>{const expiry=Date.parse(row.ends_at);return expiry>at?Math.min(end,expiry):end;},at+cacheMs);
      cached={body,etag:`"${createHash('sha256').update(body).digest('base64url')}"`,until};return cached;
    })().finally(()=>{inFlight=null;});
    return inFlight;
  }
  return async function sitemap(req,res) {
    try {
      const result=await snapshot();
      res.set('Cache-Control',`public, max-age=${Math.max(0,Math.floor((result.until-now())/1000))}, must-revalidate`);
      res.set('ETag',result.etag);res.set('X-Content-Type-Options','nosniff');
      const matches=(req.get('If-None-Match')||'').split(',').map(value=>value.trim().replace(/^W\//,''));
      if(matches.includes('*')||matches.includes(result.etag)) return res.status(304).end();
      res.type('application/xml').send(result.body);
    } catch {
      res.set('Cache-Control','no-store');res.set('Retry-After','60');
      res.status(503).type('text/plain').send('Sitemap temporarily unavailable. Please try again.');
    }
  };
}
module.exports={createSitemap,sitemapDocument,SITEMAP_QUERY,ORIGIN};
