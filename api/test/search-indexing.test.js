const test=require('node:test'),assert=require('node:assert/strict'),express=require('express');
test('API data, HEAD requests and private/error responses remain noindex without applying it to the app homepage',async()=>{
  const app=express();app.use('/api',require('../middleware/searchIndexing'));
  app.get('/',(_req,res)=>res.send('App entry'));
  app.get('/api/events/:id',(_req,res)=>res.json({title:'Event for in-app search'}));
  app.get('/api/private',(_req,res)=>res.status(401).json({error:'Sign in'}));
  app.use('/api',(_req,res)=>res.status(404).json({error:'Not found'}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  try {
    for(const [path,method,status] of [['/api/events/1','GET',200],['/api/events/1','HEAD',200],['/api/private','GET',401],['/api/missing','GET',404]]){
      const response=await fetch(base+path,{method,signal:AbortSignal.timeout(5000)});assert.equal(response.status,status);
      assert.equal(response.headers.get('X-Robots-Tag'),'noindex, follow');await response.text();
    }
    const home=await fetch(base+'/');assert.equal(home.headers.get('X-Robots-Tag'),null);await home.text();
  } finally {await new Promise(resolve=>server.close(resolve));}
});
