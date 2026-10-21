const test=require('node:test');
const assert=require('node:assert/strict');
const {generateKeyPairSync,sign}=require('node:crypto');
const {certificateURL,loadCertificateKey,signedContent,confirmationURL,verifyEnvelope,feedbackRecipients}=require('../services/sesFeedback');
const {emailHash}=require('../services/notificationPolicy');
const topicArn='arn:aws:sns:ca-central-1:123456789012:test-feedback';

test('SNS validation rejects attacker hosts, ports and paths before any network fetch',async()=>{
  for(const url of ['http://sns.ca-central-1.amazonaws.com/SimpleNotificationService-test.pem',
    'https://sns.ca-central-1.amazonaws.com.evil.test/SimpleNotificationService-test.pem',
    'https://127.0.0.1/SimpleNotificationService-test.pem',
    'https://sns.ca-central-1.amazonaws.com:8443/SimpleNotificationService-test.pem',
    'https://sns.ca-central-1.amazonaws.com/anything.pem']) assert.throws(()=>certificateURL(url,'ca-central-1'));
  await assert.rejects(()=>verifyEnvelope({TopicArn:'another-topic'}, {topicArn,loadKey:()=>assert.fail('fetched attacker certificate')}));
});
test('SNS signature verification detects modified content and stale messages',async()=>{
  const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
  const now=Date.now();
  const message={Type:'Notification',MessageId:'test-feedback-1',Message:JSON.stringify({notificationType:'Delivery'}),
    TopicArn:topicArn,Timestamp:new Date(now).toISOString(),SignatureVersion:'2',
    SigningCertURL:'https://sns.ca-central-1.amazonaws.com/SimpleNotificationService-test.pem'};
  message.Signature=sign('RSA-SHA256',Buffer.from(signedContent(message)),privateKey).toString('base64');
  assert.equal(await verifyEnvelope(message,{topicArn,now,loadKey:async()=>publicKey}),message);
  await assert.rejects(()=>verifyEnvelope({...message,Message:'tampered'},{topicArn,now,loadKey:async()=>publicKey}),/signature/);
  await assert.rejects(()=>verifyEnvelope(message,{topicArn,now:now+25*3600000,loadKey:()=>assert.fail('fetched stale certificate')}),/Expired/);
});
test('only permanent bounces and complaints become hashed suppressions',()=>{
  assert.deepEqual(feedbackRecipients({notificationType:'Bounce',bounce:{bounceType:'Transient',bouncedRecipients:[]}}),[]);
  const email='Person@Example.test';
  assert.deepEqual(feedbackRecipients({eventType:'Complaint',complaint:{complainedRecipients:[{emailAddress:email}]}}),[{hash:emailHash(email),reason:'complaint'}]);
  assert.deepEqual(feedbackRecipients({notificationType:'Bounce',bounce:{bounceType:'Permanent',bouncedRecipients:[{emailAddress:email}]}}),[{hash:emailHash(email),reason:'hard_bounce'}]);
});
test('subscription confirmation is constrained to the signed topic and token on AWS',()=>{
  const url=new URL('https://sns.ca-central-1.amazonaws.com/');
  url.search=new URLSearchParams({Action:'ConfirmSubscription',TopicArn:topicArn,Token:'test-token'}).toString();
  const envelope={Type:'SubscriptionConfirmation',TopicArn:topicArn,Token:'test-token',SubscribeURL:url.href};
  assert.equal(confirmationURL(envelope),url.href);
  assert.throws(()=>confirmationURL({...envelope,Token:'another-token'}));
  assert.throws(()=>confirmationURL({...envelope,SubscribeURL:url.href.replace('sns.ca-central-1.amazonaws.com','attacker.test')}));
});
test('SNS certificate network/5xx failure remains retryable without accepting invalid certificates',async()=>{
  const url='https://sns.ca-central-1.amazonaws.com/SimpleNotificationService-transienttest.pem';
  await assert.rejects(()=>loadCertificateKey(url,Date.now(),async()=>{throw Error('network timeout');}),error=>error.retryable===true);
  await assert.rejects(()=>loadCertificateKey(url,Date.now(),async()=>({ok:false,status:503})),error=>error.retryable===true);
  await assert.rejects(()=>loadCertificateKey(url,Date.now(),async()=>({ok:false,status:404})),error=>!error.retryable);
});
test('feedback route returns 503 for certificate outages and 400 for untrusted signatures',async()=>{
  const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
  for(const retryable of [true,false]) {
    let handler;
    const router={post(_path,...handlers){handler=handlers.at(-1);}};
    const module={exports:{}};
    const dependencies={express:{Router:()=>router,json:()=>()=>{}},'../config/db':{},
      '../services/sesFeedback':{async verifyEnvelope(){throw Object.assign(Error('test verification failure'),{retryable});}}};
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../routes/emailFeedback.js'),'utf8'),{
      module,require:name=>dependencies[name],process:{env:{SES_FEEDBACK_TOPIC_ARN:topicArn}},console:{error(){}}
    });
    const response={code:200,set(){return this;},status(code){this.code=code;return this;},json(){return this;}};
    await handler({body:{}},response);assert.equal(response.code,retryable?503:400);
  }
});
