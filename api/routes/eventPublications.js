const router=require('express').Router();
const auth=require('../middleware/auth');
const pool=require('../config/db');
const store=require('../services/eventPublications').createEventPublications(pool);
const {publicImageError,imageStatus}=require('../services/imageErrors');
// Also cover rejected authentication and HEAD responses before route handlers.
router.use(['/my-events','/event-publications'],(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
function route(handler) {return async(req,res)=>{
  res.set('Cache-Control','no-store');
  try {res.json(await handler(req));}
  catch(error) {
    if(!error.status) console.error('Event publication operation failed',error.code||error.name);
    res.status(error.status||503).json({error:error.status?error.message:'Event submissions are temporarily unavailable.'});
  }
};}
router.get('/my-events',auth,route(req=>store.published(req.user,{before:req.query.before??null})));
router.get('/event-publications',auth,route(req=>store.list(req.user,{review:req.query.review==='true',before:req.query.before??null})));
router.get('/event-publications/:id',auth,route(req=>store.get(req.params.id,req.user)));
router.post('/event-publications/:id/review',auth,route(req=>store.review(req.params.id,req.user,req.body||{})));
router.get('/event-publications/:id/image',auth,async(req,res)=>{
  res.set('Cache-Control','no-store');
  try {
    const item=await store.get(req.params.id,req.user),image=item.draft.image;
    if(!image?.url) return res.sendStatus(404);
    const bytes=await require('../services/imageDelivery').getDeliveredImage(image.url,req.query.size==='thumb'?'thumb':'detail',{expiresAt:item.draft.ends_at});
    res.set({'Content-Type':'image/webp','X-Content-Type-Options':'nosniff','Content-Disposition':'inline; filename="submission.webp"',
      'Content-Security-Policy':"default-src 'none'; sandbox",'Cross-Origin-Resource-Policy':'same-origin'}).send(bytes);
  } catch(error) {res.status(error.status||imageStatus(error)).json(error.status?{error:error.message}:publicImageError(error));}
});
module.exports=router;
