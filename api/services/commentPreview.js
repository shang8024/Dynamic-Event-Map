const {bounded}=require('./requestLimits');

const PREVIEW_LIMIT=3;
const CACHE_SECONDS=24*60*60;
const prefix='comments:preview:v1';
const cacheKey=(eventId,revision)=>`${prefix}:${eventId}:${revision}`;
const isEventId=value=>/^[1-9]\d{0,9}$/.test(String(value))&&Number(value)<=2147483647;
const PREVIEW_QUERY=`SELECT e.comment_revision revision,
  (SELECT count(*)::integer FROM comments c WHERE c.event_id=e.id) total,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('id',c.id,'text',c.text,'createdAt',c.created_at,
    'user',jsonb_build_object('id',c.user_id,'name',c.username)) ORDER BY c.created_at DESC,c.id DESC)
    FROM (SELECT c.id,left(c.text,5000) text,c.created_at,c.user_id,p.username
      FROM comments c JOIN profiles p ON p.id=c.user_id WHERE c.event_id=e.id
      ORDER BY c.created_at DESC,c.id DESC LIMIT $2) c),'[]'::jsonb) comments
  FROM events e WHERE e.id=$1`;

function validCached(value,revision) {
  return value&&String(value.revision)===String(revision)&&Number.isInteger(value.total)&&value.total>=0
    &&Array.isArray(value.comments)&&value.comments.length<=PREVIEW_LIMIT&&value.comments.length<=value.total
    &&value.comments.every(comment=>comment&&Number.isInteger(comment.id)&&comment.id>0
      &&typeof comment.text==='string'&&comment.text.length<=10000&&typeof comment.createdAt==='string'
      &&comment.user&&Number.isInteger(comment.user.id)&&typeof comment.user.name==='string');
}
function createCommentPreview({db,redis,timeoutMs=200}) {
  async function cacheRead(key,revision) {
    if(!redis?.isReady) return null;
    try {
      const raw=await bounded(redis.get(key),timeoutMs);
      if(!raw||raw.length>128*1024) return null;
      const value=JSON.parse(raw);
      return validCached(value,revision)?value:null;
    } catch {return null;}
  }
  return async function preview(eventId) {
    // The DB revision is cheap and authoritative. Each immutable cache key names
    // one committed revision, so a delayed fill cannot overwrite a newer edit.
    const {rows:[event]}=await db.query('SELECT comment_revision revision FROM events WHERE id=$1',[eventId]);
    if(!event) return null;
    const cached=await cacheRead(cacheKey(eventId,event.revision),event.revision);
    if(cached) return cached;
    // Revision, count and the bounded comment list share one PostgreSQL snapshot.
    const {rows:[snapshot]}=await db.query(PREVIEW_QUERY,[eventId,PREVIEW_LIMIT]);
    if(!snapshot) return null;
    if(redis?.isReady) {
      try {await bounded(redis.set(cacheKey(eventId,snapshot.revision),JSON.stringify(snapshot),{EX:CACHE_SECONDS}),timeoutMs);}
      catch {/* Redis is an optimization; the public DB read still succeeds. */}
    }
    return snapshot;
  };
}
function createCommentPreviewHandler(dependencies) {
  const preview=createCommentPreview(dependencies);
  return async(req,res)=>{
    res.set('Cache-Control','no-store');
    if(!isEventId(req.params.eventId)) return res.status(400).json({error:'Invalid event ID'});
    try {
      const snapshot=await preview(req.params.eventId);
      if(!snapshot) return res.status(404).json({error:'Event not found'});
      res.json(snapshot);
    } catch {res.status(503).json({error:'Unable to refresh comments'});}
  };
}
module.exports={PREVIEW_LIMIT,CACHE_SECONDS,PREVIEW_QUERY,cacheKey,isEventId,createCommentPreview,createCommentPreviewHandler};
