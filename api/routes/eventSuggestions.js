const router=require('express').Router();
const auth=require('../middleware/auth');
const pool=require('../config/db');
const {createEventSuggestions,identifier}=require('../services/eventSuggestions');
const suggestions=createEventSuggestions(pool);
function route(handler) {return async(req,res)=>{
  res.set('Cache-Control','no-store');
  try {res.json(await handler(req));}
  catch(error) {
    console.error('Event contribution operation failed',error.code||error.name);
    res.status(error.status||503).json({error:error.status?error.message:'Community updates are temporarily unavailable.'});
  }
};}
router.get('/events/:id/contributors',route(async req=>{
  const id=identifier(req.params.id),after=req.query.after==null?0:identifier(req.query.after);
  if(BigInt(id)>2147483647n) throw Object.assign(new Error('Invalid event ID.'),{status:400});
  const {rows:[event]}=await pool.query('SELECT id FROM events WHERE id=$1',[id]);
  if(!event) throw Object.assign(new Error('Event not found'),{status:404});
  const {rows}=await pool.query(`SELECT p.id,p.username AS name FROM event_contributors c JOIN profiles p ON p.id=c.user_id
    WHERE c.event_id=$1 AND c.user_id>$2::bigint ORDER BY c.user_id LIMIT 100`,[id,after]);
  return {items:rows,next:rows.length===100?rows.at(-1).id:null};
}));
router.post('/events/:id/suggestions',auth,route(req=>suggestions.submit(req.params.id,req.user,req.body)));
router.get('/event-suggestions',auth,route(req=>suggestions.list(req.user,{review:req.query.review==='true',before:req.query.before??null})));
router.get('/event-suggestions/:id',auth,route(req=>suggestions.get(req.params.id,req.user)));
router.post('/event-suggestions/:id/review',auth,route(req=>suggestions.review(req.params.id,req.user,req.body||{})));
module.exports=router;
