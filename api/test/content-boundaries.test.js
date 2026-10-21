const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {buildMessage}=require('../services/notificationMessages');

const malicious=`<img src=x onerror=alert(1)> '; DROP TABLE profiles; --`;
function load(relativePath,dependencies) {
  const filename=path.resolve(__dirname,'..',relativePath),module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,console,
    AbortSignal,require(name){assert.ok(Object.hasOwn(dependencies,name),`Unexpected dependency ${name}`);return dependencies[name];}}, {filename});
  return module.exports;
}

test('event and comment content remains literal SQL parameters, never statement syntax', async()=>{
  const calls=[];
  const db={async query(sql,values){calls.push({sql,values});return {rows:[{id:42}]};},release(){}};
  const pool={...db,async connect(){return db;}};
  const comments=load('models/commentModel.js',{'../config/db':pool});
  await comments.create({eventId:42,userId:7,text:malicious});
  const comment=calls.at(-1);
  assert.match(comment.sql,/VALUES \(\$1, \$2, \$3\)/);
  assert.deepEqual(Array.from(comment.values),[42,7,malicious]);

  const events=load('models/eventModel.js',{
    '../config/db':pool,'../services/eventSchedule':require('../services/eventSchedule'),
  });
  await events.create({user_id:7,title:malicious,description:malicious,location_address:malicious,
    lat:43.65,lng:-79.38,category:'Other',starts_at:'2026-11-01T14:00:00Z',ends_at:'2026-11-01T15:00:00Z'});
  const event=calls.find(call=>call.sql.includes('INSERT INTO events'));
  assert.equal(event.values[1],malicious);
  assert.equal(event.values[2],malicious);
  assert.equal(event.values[6],malicious);
  assert.match(event.sql,/VALUES\(\$1,\$2,\$3/);
  assert.ok(calls.every(call=>!call.sql.includes(malicious)));
});

test('SES messages keep untrusted event content in plain text and sanitize subject newlines', async()=>{
  const message=buildMessage({kind:'reminder',user_id:7,delivery_email:'recipient@example.test',
    title:`${malicious}\r\nBcc: attacker@example.test`,location_name:malicious,location_address:malicious,
    occurrence_start:'2026-11-01T14:00:00Z'},{key:'local-test-signing-secret',
    config:{origin:'https://example.test',sender:'Event Map',contact:''}});
  assert.ok(message.text.includes(malicious));
  let sent;
  const provider=load('services/emailProvider.js',{
    'node:fs':{},'@aws-sdk/client-sesv2':{
      SESv2Client:class {async send(command){sent=command.input;return {MessageId:'fixture-only'};}},
      SendEmailCommand:class {constructor(input){this.input=input;}},
    },
  }).createEmailProvider({EMAIL_PROVIDER:'ses',EMAIL_DELIVERY_ENABLED:'true',EMAIL_FEEDBACK_READY:'true',EMAIL_FROM:'notifications@example.test'});
  assert.equal((await provider.send(message)).messageId,'fixture-only');
  assert.equal(Object.hasOwn(sent.Content.Simple.Body,'Html'),false);
  assert.equal(sent.Content.Simple.Body.Text.Data,message.text);
  assert.doesNotMatch(sent.Content.Simple.Subject.Data,/[\r\n]/);
  assert.deepEqual(Array.from(sent.Destination.ToAddresses),['recipient@example.test']);
  assert.equal(Object.hasOwn(sent.Destination,'BccAddresses'),false);
});
