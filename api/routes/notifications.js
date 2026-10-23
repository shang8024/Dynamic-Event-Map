const router=require('express').Router();
const auth=require('../middleware/auth');
const pool=require('../config/db');
router.get('/notifications',auth,async(req,res)=>{
  try {
    const before=/^\d+$/.test(req.query.before||'')?req.query.before:null;
    const {rows}=await pool.query(`SELECT id,event_id,suggestion_id,kind,title,message,read_at,created_at FROM in_app_notifications
      WHERE user_id=$1 AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 30`,[req.user.id,before]);
    const {rows:[count]}=await pool.query('SELECT count(*)::integer unread FROM in_app_notifications WHERE user_id=$1 AND read_at IS NULL',[req.user.id]);
    res.set('Cache-Control','no-store').json({items:rows,unread:count.unread,next:rows.length===30?rows.at(-1).id:null});
  } catch {res.status(503).json({error:'Notifications are temporarily unavailable'});}
});
router.post('/notifications/read',auth,async(req,res)=>{
  try {
    const id=req.body.id;
    if(id!=null && !/^\d+$/.test(String(id))) return res.status(400).json({error:'Invalid notification'});
    await pool.query('UPDATE in_app_notifications SET read_at=COALESCE(read_at,now()) WHERE user_id=$1 AND ($2::bigint IS NULL OR id=$2)',[req.user.id,id||null]);
    require('../socket').getIO().to(`user_${req.user.id}`).emit('notification:changed',{});
    res.json({ok:true});
  } catch {res.status(503).json({error:'Unable to mark notifications read'});}
});
module.exports=router;
