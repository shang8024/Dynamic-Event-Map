const express=require('express');
const pool=require('../config/db');
const firebaseAuth=require('../middleware/auth');
const policy=require('../services/notificationPolicy');
const {readPreferences,savePreferences}=require('../services/preferences');
const {recommendations}=require('../services/recommendations');
const router=express.Router();
function unavailable(res,error) {
  console.error('Interest service unavailable',error.code || error.name);
  return res.status(503).json({message:'Settings are temporarily unavailable. Please try again.'});
}
router.get('/me/preferences',firebaseAuth,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try { res.json(await readPreferences(pool,req.user.id)); } catch(error) { unavailable(res,error); }
});
router.put('/me/preferences',firebaseAuth,async(req,res)=>{
  let changes;
  try { changes=policy.validatePreferences(req.body); } catch(error) { return res.status(400).json({message:error.message}); }
  res.set('Cache-Control','no-store');
  try { res.json(await savePreferences(pool,req.user.id,changes,req.firebase)); } catch(error) { unavailable(res,error); }
});
router.get('/recommendations',firebaseAuth,async(req,res)=>{
  const limit=Number(req.query.limit ?? 12);
  if (!Number.isInteger(limit) || limit<1 || limit>30) return res.status(400).json({message:'Limit must be between 1 and 30'});
  res.set('Cache-Control','no-store');
  try { res.json(await recommendations(pool,req.user.id,limit)); } catch(error) { unavailable(res,error); }
});
router.post('/notifications/unsubscribe',async(req,res)=>{
  res.set('Cache-Control','no-store');
  let identity;
  try { identity=policy.verifyUnsubscribe(req.body?.token,policy.secret()); }
  catch { return res.status(400).json({message:'Invalid or expired unsubscribe link. You can also change your email settings after signing in.'}); }
  const changes={};
  if (identity.scope==='reminders' || identity.scope==='all') changes.reminders_enabled=false;
  if (identity.scope==='marketing' || identity.scope==='all') changes.marketing_enabled=false;
  try {
    // A deleted account is already unsubscribed; do not recreate it.
    const exists=await pool.query('SELECT 1 FROM profiles WHERE id=$1',[identity.userId]);
    if (exists.rowCount) await savePreferences(pool,identity.userId,changes,null,{source:'signed_unsubscribe'});
    res.json({unsubscribed:true,scope:identity.scope});
  } catch(error) { unavailable(res,error); }
});
module.exports=router;
