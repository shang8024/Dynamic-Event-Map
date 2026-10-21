require('dotenv').config();
const pool=require('../config/db');
const policy=require('../services/notificationPolicy');
const outbox=require('../services/notificationOutbox');
const {recommendations}=require('../services/recommendations');
const {createEmailProvider,classifySendFailure}=require('../services/emailProvider');
const {configuration,buildMessage}=require('../services/notificationMessages');

async function runOnce({db=pool,env=process.env,provider,verifyIdentity}={}) {
  const schedule=await outbox.scheduleNotifications(db);
  const delivery=provider || createEmailProvider(env);
  if (!delivery.enabled) {
    const preview=await db.query(`UPDATE notification_outbox SET last_dry_run_at=now() WHERE id IN
      (SELECT id FROM notification_outbox WHERE status='pending' AND scheduled_for<=now() AND expires_at>now() ORDER BY id LIMIT 25) RETURNING id,kind`);
    return {mode:'dry_run',schedule,would_send:preview.rowCount};
  }
  const key=policy.secret(env),config=configuration(env);
  const identityLookup=verifyIdentity || (uid=>require('../config/firebaseAdmin').auth().getUser(uid));
  const marketingEnabled=env.MARKETING_DELIVERY_ENABLED==='true' && Boolean(config.contact.trim());
  let sent=0,cancelled=0,failed=0;
  for (let count=0;count<25;count++) {
    const job=await outbox.claimNext(db,{marketingEnabled});
    if (!job) break;
    let identity;
    try {
      const row=await outbox.inspectJob(db,job);
      identity=await identityLookup(row?.verified_uid);
    } catch {
      await outbox.finishDispatch(db,job,{status:job.attempts<5?'pending':'failed',code:'identity_check_unavailable'});failed++;continue;
    }
    let row;
    try {
      row=await outbox.beginDispatch(db,job,identity);
      if (!row) {cancelled++;continue;}
      const events=row.kind==='marketing'?(await recommendations(db,row.user_id,6)).events:[];
      const message=buildMessage(row,{key,config,events});
      if (!message) {await outbox.finishDispatch(db,job,{status:'cancelled',code:'no_current_events'});cancelled++;continue;}
      const result=await delivery.send(message);
      await outbox.finishDispatch(db,job,{status:'sent',messageId:result.messageId});sent++;
    } catch(error) {
      await outbox.finishDispatch(db,job,classifySendFailure(error,job.attempts));failed++;
    }
  }
  return {mode:'ses',schedule,sent,cancelled,failed};
}
if (require.main===module) {
  runOnce().then(result=>console.log(JSON.stringify(result))).catch(error=>{
    console.error('Notification worker failed',error.code || error.name);process.exitCode=1;
  }).finally(()=>pool.end());
}
module.exports={runOnce};
