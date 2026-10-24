const router=require('express').Router({mergeParams:true});
const auth=require('../middleware/auth');
const pool=require('../config/db');
const {canManageEvent}=require('../services/eventPermissions');
const images=require('../services/eventImages');
const {publicImageError,imageStatus}=require('../services/imageErrors');
router.get('/',async(req,res)=>{
  try {
    if(!/^\d{1,10}$/.test(req.params.eventId)) return res.sendStatus(404);
    const {rows:[event]}=await pool.query('SELECT ends_at,status,data FROM events WHERE id=$1',[req.params.eventId]);
    const image=event && images.sourceImage(event);
    if(!image?.url) return res.sendStatus(404);
    const bytes=await require('../services/imageDelivery').getDeliveredImage(image.url,req.query.size==='thumb'?'thumb':'detail',{expiresAt:event.ends_at,revision:image.revision});
    const maxAge=event.ends_at?Math.max(0,Math.min(3600,Math.floor((new Date(event.ends_at)-Date.now())/1000))):3600;
    res.set({'Content-Type':'image/webp','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="event.webp"',
      'Content-Security-Policy':"default-src 'none'; sandbox",'Cache-Control':`public, max-age=${maxAge}`,'Cross-Origin-Resource-Policy':'same-origin'}).send(bytes);
  } catch(error) {const status=imageStatus(error);res.set('Cache-Control','no-store');if(status>=500)res.set('Retry-After','2');res.status(status).json(publicImageError(error));}
});
router.put('/',auth,async(req,res)=>{
  let url;
  try {url=images.validateImageURL(req.body.url).href;} catch(error) {return res.status(400).json(publicImageError(error));}
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    const {rows:[event]}=await db.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[req.params.eventId]);
    if(!event) {await db.query('ROLLBACK');return res.sendStatus(404);}
    if(!canManageEvent(req.user,event)) {await db.query('ROLLBACK');return res.sendStatus(403);}
    const image={url,source:'link',alt:String(req.body.alt||event.title).slice(0,500),credit:String(req.body.credit||'').slice(0,300)};
    // Verify and decode before publishing a link; subsequent reads revalidate it.
    await images.getImage(url,'thumb');
    const {rows:[updated]}=await db.query(`UPDATE events SET data=data||$2::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[event.id,JSON.stringify({image,image_hidden:false})]);
    await db.query("INSERT INTO event_edit_history(event_id,actor_id,action) VALUES($1,$2,'image_link')",[event.id,req.user.id]);
    await db.query('COMMIT');res.json(updated);
  } catch(error) {await db.query('ROLLBACK');res.status(422).json(publicImageError(error));}
  finally {db.release();}
});
router.delete('/',auth,async(req,res)=>{
  try {
    const {rows:[event]}=await pool.query('SELECT * FROM events WHERE id=$1',[req.params.eventId]);
    if(!event) return res.sendStatus(404);
    if(!canManageEvent(req.user,event)) return res.sendStatus(403);
    const {rows:[updated]}=await pool.query(`UPDATE events SET data=(data-'image')||'{"image_hidden":true}'::jsonb,version=version+1,updated_at=now() WHERE id=$1 RETURNING *`,[event.id]);
    res.json(updated);
  } catch {res.status(503).json({error:'Unable to remove this photo'});}
});
module.exports=router;
