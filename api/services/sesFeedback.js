const {verify,X509Certificate}=require('node:crypto');
const {emailHash}=require('./notificationPolicy');
const certificateCache=new Map();

function certificateURL(value,region) {
  const url=new URL(value);
  if(url.protocol!=='https:' || url.hostname!==`sns.${region}.amazonaws.com` || url.port || url.username || url.password ||
    url.search || url.hash || !/^\/SimpleNotificationService-[A-Za-z0-9]+\.pem$/.test(url.pathname)) throw new Error('Untrusted SNS certificate URL');
  return url.href;
}
function certificateUnavailable() {
  return Object.assign(new Error('SNS certificate temporarily unavailable'),{retryable:true});
}
async function loadCertificateKey(url,now,fetcher=fetch) {
  const cached=certificateCache.get(url);
  if(cached && cached.until>now) return cached.promise;
  if(certificateCache.size>=4) certificateCache.delete(certificateCache.keys().next().value);
  const promise=(async()=>{
    let response;
    try {response=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(5000)});}
    catch {throw certificateUnavailable();}
    if(!response.ok) {
      try {await response.body?.cancel();} catch { /* classification follows the known HTTP status */ }
      if(response.status===429 || response.status>=500) throw certificateUnavailable();
      throw new Error('Invalid SNS certificate');
    }
    const chunks=[];let bytes=0;
    try {
      for await(const chunk of response.body) {
        bytes+=chunk.length;
        if(bytes>16384) throw Object.assign(new Error('SNS certificate exceeds limit'),{code:'CERTIFICATE_TOO_LARGE'});
        chunks.push(chunk);
      }
    } catch(error) {
      if(error.code==='CERTIFICATE_TOO_LARGE') throw error;
      throw certificateUnavailable();
    }
    const cert=new X509Certificate(Buffer.concat(chunks));
    if(Date.parse(cert.validFrom)>now || Date.parse(cert.validTo)<now) throw new Error('SNS certificate is expired');
    const cachedEntry=certificateCache.get(url);
    if(cachedEntry) cachedEntry.until=Math.min(cachedEntry.until,Date.parse(cert.validTo));
    return cert.publicKey;
  })();
  certificateCache.set(url,{promise,until:now+3600000});
  try{return await promise;}catch(error){certificateCache.delete(url);throw error;}
}
function signedContent(envelope) {
  const fields=envelope.Type==='Notification'?['Message','MessageId','Subject','Timestamp','TopicArn','Type']:
    ['Message','MessageId','SubscribeURL','Timestamp','Token','TopicArn','Type'];
  return fields.filter(field=>field!=='Subject' || Object.hasOwn(envelope,field)).map(field=>{
    if(typeof envelope[field]!=='string' || !envelope[field]) throw new Error('Malformed SNS envelope');
    return `${field}\n${envelope[field]}\n`;
  }).join('');
}
function confirmationURL(envelope) {
  const region=envelope.TopicArn.split(':')[3];
  const url=new URL(envelope.SubscribeURL);
  if(envelope.Type!=='SubscriptionConfirmation' || url.protocol!=='https:' || url.hostname!==`sns.${region}.amazonaws.com` ||
    url.port || url.username || url.password || url.hash || url.pathname!=='/' ||
    url.searchParams.get('Action')!=='ConfirmSubscription' || url.searchParams.get('TopicArn')!==envelope.TopicArn ||
    url.searchParams.get('Token')!==envelope.Token) throw new Error('Invalid SNS confirmation URL');
  return url.href;
}
async function confirmSubscription(envelope) {
  const response=await fetch(confirmationURL(envelope),{redirect:'error',signal:AbortSignal.timeout(5000)});
  await response.body?.cancel();
  if(!response.ok) throw new Error('SNS subscription confirmation failed');
}
async function verifyEnvelope(envelope,{topicArn,now=Date.now(),loadKey=loadCertificateKey}={}) {
  const topic=String(topicArn || '').match(/^arn:aws:sns:([a-z0-9-]+):\d{12}:[A-Za-z0-9_-]+$/);
  if(!topic || !envelope || envelope.TopicArn!==topicArn || !['Notification','SubscriptionConfirmation','UnsubscribeConfirmation'].includes(envelope.Type)) throw new Error('Untrusted SNS topic');
  if(JSON.stringify(envelope).length>100000 || typeof envelope.Signature!=='string' || envelope.Signature.length>2048 ||
    !['1','2'].includes(envelope.SignatureVersion)) throw new Error('Malformed SNS signature');
  const timestamp=Date.parse(envelope.Timestamp);
  if(!Number.isFinite(timestamp) || timestamp<now-24*3600000 || timestamp>now+300000) throw new Error('Expired SNS message');
  const url=certificateURL(envelope.SigningCertURL,topic[1]);
  const content=signedContent(envelope);
  const key=await loadKey(url,now);
  if(!verify(envelope.SignatureVersion==='2'?'RSA-SHA256':'RSA-SHA1',Buffer.from(content),key,Buffer.from(envelope.Signature,'base64'))) throw new Error('Invalid SNS signature');
  return envelope;
}
function feedbackRecipients(message) {
  const type=message.notificationType || message.eventType;
  const reason=type==='Complaint'?'complaint':type==='Bounce' && message.bounce?.bounceType==='Permanent'?'hard_bounce':null;
  if(!reason) return [];
  const recipients=reason==='complaint'?message.complaint?.complainedRecipients:message.bounce?.bouncedRecipients;
  if(!Array.isArray(recipients) || recipients.length>1000) throw new Error('Invalid SES feedback recipients');
  return recipients.map(row=>{
    const email=row.emailAddress;
    if(typeof email!=='string' || email.length>320 || !/^[^\s@]+@[^\s@]+$/.test(email)) throw new Error('Invalid SES feedback address');
    return {hash:emailHash(email),reason};
  });
}
async function recordFeedback(pool,envelope) {
  const recipients=feedbackRecipients(JSON.parse(envelope.Message));
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    const receipt=await client.query('INSERT INTO email_feedback_receipts(message_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING message_id',[envelope.MessageId]);
    if(receipt.rowCount) for(const {hash,reason} of recipients) {
      await client.query(`INSERT INTO email_suppressions(email_hash,reason) VALUES($1,$2) ON CONFLICT(email_hash)
        DO UPDATE SET reason=CASE WHEN email_suppressions.reason='complaint' THEN 'complaint' ELSE EXCLUDED.reason END`,[hash,reason]);
    }
    await client.query('COMMIT');return {duplicate:!receipt.rowCount,suppressions:receipt.rowCount?recipients.length:0};
  } catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
module.exports={certificateURL,loadCertificateKey,signedContent,confirmationURL,confirmSubscription,verifyEnvelope,feedbackRecipients,recordFeedback};
