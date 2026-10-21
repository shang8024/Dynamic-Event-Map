const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),express=require('express');
const errors=require('../middleware/errors');

test('malformed and oversized JSON bodies return bounded JSON errors without echoing input or stack traces',async()=>{
  const app=express();app.use(express.json({limit:'64b'}));app.post('/body',(_req,res)=>res.json({accepted:true}));app.use(errors);
  const server=http.createServer(app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/body`;
  try {
    const malformed=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"secret-input":broken'});
    assert.equal(malformed.status,400);assert.match(malformed.headers.get('content-type'),/application\/json/);
    assert.deepEqual(await malformed.json(),{message:'Invalid JSON request body'});
    const oversized=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:'x'.repeat(100)})});
    assert.equal(oversized.status,413);assert.deepEqual(await oversized.json(),{message:'Request body is too large'});
  } finally {await new Promise(resolve=>server.close(resolve));}
});
