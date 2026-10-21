const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const express=require('express');
test('the private inbox does not intercept public signed SES feedback',async()=>{
  const filename=path.resolve(__dirname,'../routes/notifications.js'),module={exports:{}};
  const dependencies={'express':express,'../middleware/auth':(_req,res)=>res.status(401).json({error:'Sign in required'}),
    '../config/db':{query(){assert.fail('An unauthenticated request reached the database');}}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{module,exports:module.exports,require:name=>{assert.ok(Object.hasOwn(dependencies,name),name);return dependencies[name];}},{filename});
  const app=express();app.use('/api',module.exports);
  app.post('/api/notifications/feedback/ses',(_req,res)=>res.status(202).json({received:true}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal((await fetch(`${origin}/api/notifications`)).status,401);
    assert.equal((await fetch(`${origin}/api/notifications/read`,{method:'POST'})).status,401);
    const feedback=await fetch(`${origin}/api/notifications/feedback/ses`,{method:'POST'});
    assert.equal(feedback.status,202);assert.deepEqual(await feedback.json(),{received:true});
  } finally {await new Promise(resolve=>server.close(resolve));}
});
