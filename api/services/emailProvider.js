const fs=require('node:fs');
const {SESv2Client,SendEmailCommand}=require('@aws-sdk/client-sesv2');

function createEmailProvider(env=process.env) {
  if (env.EMAIL_PROVIDER!=='ses' || env.EMAIL_DELIVERY_ENABLED!=='true' || env.EMAIL_FEEDBACK_READY!=='true') {
    return {enabled:false,async send(){throw new Error('Email delivery is disabled');}};
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.EMAIL_FROM || '')) throw new Error('A verified EMAIL_FROM is required');
  let credentials;
  if (env.SES_ACCESS_KEY_ID_FILE && env.SES_SECRET_ACCESS_KEY_FILE) {
    credentials={accessKeyId:fs.readFileSync(env.SES_ACCESS_KEY_ID_FILE,'utf8').trim(),secretAccessKey:fs.readFileSync(env.SES_SECRET_ACCESS_KEY_FILE,'utf8').trim()};
  } else if (env.AWS_ACCESS_KEY_ID || env.AWS_SECRET_ACCESS_KEY) {
    throw new Error('Use dedicated SES secret files or an instance role; do not reuse backup credentials');
  }
  // Never let the SDK retry an ambiguous accepted send behind the outbox.
  const client=new SESv2Client({region:env.SES_REGION || 'ca-central-1',credentials,maxAttempts:1});
  return {enabled:true,async send({to,subject,text,unsubscribeURL}) {
    const command=new SendEmailCommand({FromEmailAddress:env.EMAIL_FROM,
      Destination:{ToAddresses:[to]},ConfigurationSetName:env.SES_CONFIGURATION_SET || undefined,
      Content:{Simple:{Subject:{Data:subject.replace(/[\r\n]/g,' ').slice(0,200),Charset:'UTF-8'},
        Body:{Text:{Data:text,Charset:'UTF-8'}},Headers:[{Name:'List-Unsubscribe',Value:`<${unsubscribeURL}>`}]}}});
    const result=await client.send(command,{abortSignal:AbortSignal.timeout(15000)});
    return {messageId:result.MessageId};
  }};
}
function classifySendFailure(error,attempts) {
  if (['TooManyRequestsException','LimitExceededException'].includes(error.name)) return {status:attempts<5?'pending':'failed',code:'provider_throttled'};
  if (['MessageRejected','BadRequestException','MailFromDomainNotVerifiedException','AccountSuspendedException','SendingPausedException','NotFoundException','AccessDeniedException'].includes(error.name)) return {status:'failed',code:'provider_rejected'};
  // Timeouts, socket errors, and server failures can happen after acceptance.
  return {status:'uncertain',code:'provider_result_unknown'};
}
module.exports={createEmailProvider,classifySendFailure};
