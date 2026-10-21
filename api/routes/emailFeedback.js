const express=require('express');
const pool=require('../config/db');
const {verifyEnvelope,recordFeedback,confirmSubscription}=require('../services/sesFeedback');
const router=express.Router();
// SNS uses text/plain unless the subscription was configured otherwise.
router.post('/notifications/feedback/ses',express.json({type:'text/plain',limit:'100kb'}),async(req,res)=>{
  res.set('Cache-Control','no-store');
  if(!process.env.SES_FEEDBACK_TOPIC_ARN) return res.status(503).json({message:'Feedback processing is not configured'});
  let envelope;
  try{envelope=await verifyEnvelope(req.body,{topicArn:process.env.SES_FEEDBACK_TOPIC_ARN});}
  catch(error){
    // SNS does not retry HTTP 400. A temporary certificate-host failure must
    // remain retryable so a genuine complaint/bounce is not silently lost.
    return res.status(error.retryable?503:400).json({message:error.retryable?'Feedback verification temporarily unavailable':'Invalid feedback signature'});
  }
  if(envelope.Type!=='Notification') {
    if(envelope.Type==='SubscriptionConfirmation' && process.env.SES_AUTO_CONFIRM_SUBSCRIPTION==='true') {
      try {await confirmSubscription(envelope);return res.json({confirmed:true});}
      catch {return res.status(503).json({message:'Subscription confirmation temporarily unavailable'});}
    }
    // The explicit setup flag permits only the signature-verified topic/token
    // on its exact regional AWS endpoint; otherwise no URL is followed.
    return res.status(202).json({message:'Subscription confirmation requires operator setup'});
  }
  try {await recordFeedback(pool,envelope);res.json({accepted:true});}
  catch(error){console.error('SES feedback processing failed',error.code || error.name);res.status(503).json({message:'Feedback processing temporarily unavailable'});}
});
module.exports=router;
