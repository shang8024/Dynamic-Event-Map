// Lets the submission form warn a member that the event they are about to post may already be listed.
const router=require('express').Router();
const auth=require('../middleware/auth');
const duplicates=require('../services/eventDuplicates').createEventDuplicates(require('../config/db'));
router.post('/events/duplicates',auth,async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!req.user) return res.status(401).json({error:'Authentication required'});
  try {res.json({items:await duplicates.find(req.body)});}
  catch(error) {
    if(!error.status) console.error('Duplicate check failed',error.code||error.name);
    res.status(error.status||503).json({error:error.status?error.message:'Unable to check for similar events right now.'});
  }
});
module.exports=router;
