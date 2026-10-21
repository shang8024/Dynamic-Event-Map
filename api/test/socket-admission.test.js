const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {createSocketAdmission}=require('../services/socketAdmission');
const request=(address='203.0.113.1',forwarded)=>({socket:{remoteAddress:address},headers:forwarded?{'x-forwarded-for':forwarded}:{}});

test('offline realtime admission fails closed without queueing Redis commands',async()=>{
  const admission=createSocketAdmission({isReady:false,eval(){assert.fail('offline command');}});
  try {assert.equal(await admission.acquire(request()),null);} finally {await admission.close();}
});
test('socket connection budgets use only the configured immediate proxy, not arbitrary forwarded IPs',async()=>{
  const calls=[],redis={isReady:true,async eval(script,value){calls.push(value);return 1;}};
  const admission=createSocketAdmission(redis,{trustedProxyCIDRs:'10.0.1.0/24'});
  try {
    const a=await admission.acquire(request('203.0.113.1','1.2.3.4')),b=await admission.acquire(request('203.0.113.1','9.8.7.6'));
    assert.equal(a.ipHash,b.ipHash);assert.equal(calls[0].keys[0],calls[1].keys[0]);
    const c=await admission.acquire(request('10.0.1.9','1.2.3.4, 198.51.100.1')),d=await admission.acquire(request('10.0.1.9','9.8.7.6, 198.51.100.1'));
    assert.equal(c.ipHash,d.ipHash);assert.notEqual(c.ipHash,a.ipHash);
  } finally {await admission.close();}
});

test('private realtime sessions close when periodic account revalidation fails',async()=>{
  const redis={isReady:true,async eval(){return 1;}},admission=createSocketAdmission(redis);
  try {
    const lease=await admission.acquire(request());let checks=0,closed=0;
    lease.revalidate=async()=>{checks++;return false;};
    const engine=new EventEmitter();engine.request={eventmapAdmission:lease};engine.close=()=>{closed++;engine.emit('close');};
    admission.attach(engine);await admission.renew();
    assert.equal(checks,1);assert.equal(closed,1);assert.equal(lease.closed,true);
  } finally {await admission.close();}
});

test('abandoned handshakes are never renewed and release their live slot after the handshake timeout',async()=>{
  let commands=0;const redis={isReady:true,async eval(){commands++;return 1;}};
  const admission=createSocketAdmission(redis,{handshakeTimeoutMs:20,heartbeatMs:50000});
  try {
    const lease=await admission.acquire(request());assert.ok(lease);
    await admission.renew();assert.equal(commands,1,'unattached handshakes must not renew Redis leases');
    await new Promise(resolve=>setTimeout(resolve,25));await admission.renew();
    assert.equal(lease.closed,true);assert.equal(commands,2,'the abandoned reservation is explicitly released');
  } finally {await admission.close();}
});
test('real Redis shares connection, identity and room budgets and expires crashed leases',
  {skip:process.env.SOCKET_ABUSE_REDIS_TEST!=='1'},async()=>{
  assert.equal(process.env.REDIS_HOST,'127.0.0.1');assert.equal(process.env.REDIS_PORT,'56379');
  const {createClient}=require('redis'),client=createClient({socket:{host:process.env.REDIS_HOST,port:Number(process.env.REDIS_PORT),reconnectStrategy:false},password:process.env.REDIS_PASSWORD,database:1});
  client.on('error',()=>{});await client.connect();
  const prefix=`socket:test:${process.pid}:${Date.now()}`,options={prefix,perIP:2,perUser:1,globalMaximum:3,localMaximum:10,joinsPerMinute:2,leaseMs:800,heartbeatMs:50000};
  let ready=true;const redis={get isReady(){return ready&&client.isReady;},eval:(...args)=>client.eval(...args)};
  const a=createSocketAdmission(redis,options),b=createSocketAdmission(redis,options),c=createSocketAdmission(redis,options);
  try {
    const first=await a.acquire(request()),second=await b.acquire(request());assert.ok(first&&second);
    assert.equal(await c.acquire(request()),null,'per-IP cap is shared across service instances');
    assert.equal(await a.bindUser(first,7),true);assert.equal(await b.bindUser(second,7),false);
    assert.equal(await a.allowJoin(first),true);assert.equal(await b.allowJoin(second),true);assert.equal(await a.allowJoin(first),false);
    const third=await a.acquire(request('203.0.113.2'));assert.ok(third);
    assert.equal(await c.acquire(request('203.0.113.3')),null,'global live cap is shared');
    await b.release(second);assert.ok(await c.acquire(request('203.0.113.3')),'disconnect releases a slot');
    await new Promise(resolve=>setTimeout(resolve,900));
    assert.ok(await b.acquire(request()),'a crashed replica does not hold slots forever');
    const engine=new EventEmitter();engine.request={eventmapAdmission:first};let closed=0;engine.close=()=>{closed++;engine.emit('close');};
    a.attach(engine);ready=false;await a.renew();assert.equal(closed,1,'unguarded connections close when Redis is unavailable');ready=true;
    const attempts=createSocketAdmission(redis,{...options,prefix:prefix+':attempt',attemptsPerMinute:1});
    const lease=await attempts.acquire(request());assert.ok(lease);await attempts.release(lease);
    assert.equal(await attempts.acquire(request()),null,'reconnects do not reset the handshake budget');await attempts.close();
  } finally {
    ready=true;await Promise.all([a.close(),b.close(),c.close()]);
    const keys=[];for await(const key of client.scanIterator({MATCH:prefix+':*'})) keys.push(key);if(keys.length) await client.del(keys);await client.quit();
  }
});
test('real Socket.IO handshake limits are shared across replicas and reject untrusted browser origins',
  {skip:process.env.SOCKET_ABUSE_REDIS_TEST!=='1'},async()=>{
  assert.equal(process.env.REDIS_HOST,'127.0.0.1');
  const http=require('node:http'),{io:connect}=require('socket.io-client'),sockets=require('../socket');
  const servers=[],clients=[],prefix=`socket-network-test:${process.pid}:${Date.now()}`;
  function result(url,extraHeaders) {return new Promise(resolve=>{
    const client=connect(url,{transports:['websocket'],forceNew:true,reconnection:false,timeout:2000,extraHeaders});clients.push(client);
    client.once('connect',()=>resolve({connected:true,client}));client.once('connect_error',()=>resolve({connected:false,client}));
  });}
  try {
    const urls=[];
    for(let n=0;n<2;n++) {
      const server=http.createServer(),io=await sockets.init(server,{adapterKey:prefix,eventDB:{async query(){return {rowCount:1};}},admission:{perIP:2,globalMaximum:5,attemptsPerMinute:20}});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(io);urls.push(`http://127.0.0.1:${server.address().port}`);
    }
    for(let n=0;n<4;n++) {
      const rejected=await fetch(`${urls[0]}/socket.io/?EIO=3&transport=polling`);
      assert.equal(rejected.status,400,'rejected legacy handshakes must release capacity rather than exhaust it');
      await rejected.arrayBuffer();
    }
    const a=await result(urls[0]),b=await result(urls[1]);assert.equal(a.connected,true);assert.equal(b.connected,true);
    assert.equal((await result(urls[1])).connected,false);
    a.client.close();await new Promise(resolve=>setTimeout(resolve,100));
    assert.equal((await result(urls[1])).connected,true);
    assert.equal((await result(urls[0],{Origin:'https://untrusted.example'})).connected,false);
  } finally {for(const client of clients) client.close();for(const io of servers) await io.shutdown();}
});

test('real Socket.IO rejects blocked accounts and closes existing sessions after revocation or unavailable profiles',
  {skip:process.env.SOCKET_ABUSE_REDIS_TEST!=='1'},async()=>{
  assert.equal(process.env.REDIS_HOST,'127.0.0.1');
  const http=require('node:http'),{io:connect}=require('socket.io-client'),sockets=require('../socket');
  const server=http.createServer(),clients=[],prefix=`socket-auth-test:${process.pid}:${Date.now()}`;
  const authTime=Math.floor(Date.now()/1000),identity={uid:'socket-local-test',email_verified:true,exp:authTime+60,auth_time:authTime};
  let current={id:123,disabled_at:null,token_valid_after:null},unavailable=false;
  const io=await sockets.init(server,{adapterKey:prefix,verifyIdentity:async()=>identity,
    profileByUid:async()=>{if(unavailable) throw new Error('Local profile unavailable');return current;},
    admission:{heartbeatMs:30,leaseMs:1000,attemptsPerMinute:20}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}`;
  const result=()=>new Promise(resolve=>{
    const client=connect(url,{transports:['websocket'],auth:{token:'local-test-fixture'},forceNew:true,reconnection:false,timeout:2000});clients.push(client);
    client.once('connect',()=>resolve({connected:true,client}));client.once('connect_error',()=>resolve({connected:false,client}));
  });
  const disconnected=client=>Promise.race([new Promise(resolve=>client.once('disconnect',resolve)),
    new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Private socket was not revoked promptly')),1500);timer.unref();})]);
  try {
    current={...current,disabled_at:new Date()};assert.equal((await result()).connected,false);
    current={...current,disabled_at:null};const a=await result();assert.equal(a.connected,true);
    let ended=disconnected(a.client);current={...current,token_valid_after:new Date((authTime+1)*1000)};await ended;
    assert.equal((await result()).connected,false,'old auth_time cannot restore private access');
    current={...current,token_valid_after:null};const b=await result();assert.equal(b.connected,true);
    ended=disconnected(b.client);unavailable=true;await ended;
  } finally {for(const client of clients) client.close();await io.shutdown();}
});

test('concurrent room requests reserve room slots before asynchronous event lookups',
  {skip:process.env.SOCKET_ABUSE_REDIS_TEST!=='1'},async()=>{
  assert.equal(process.env.REDIS_HOST,'127.0.0.1');
  const http=require('node:http'),{io:connect}=require('socket.io-client'),sockets=require('../socket'),server=http.createServer();
  const lookups=[],io=await sockets.init(server,{adapterKey:`socket-room-test:${process.pid}:${Date.now()}`,
    eventDB:{query(){return new Promise(resolve=>lookups.push(()=>resolve({rowCount:1})));}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const client=connect(`http://127.0.0.1:${server.address().port}`,{transports:['websocket'],forceNew:true,reconnection:false});
  try {
    await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('connect_error',reject);});
    const replies=Array.from({length:10},(_,index)=>new Promise(resolve=>client.emit('joinEventRoom',String(index+1),resolve)));
    await new Promise(resolve=>setTimeout(resolve,50));assert.equal(lookups.length,5);
    for(const finish of lookups) finish();
    assert.equal((await Promise.all(replies)).filter(reply=>reply.ok).length,5);
  } finally {client.close();await io.shutdown();}
});

test('room lookups have a process-wide bound and leaving cancels a pending subscription',
  {skip:process.env.SOCKET_ABUSE_REDIS_TEST!=='1'},async()=>{
  assert.equal(process.env.REDIS_HOST,'127.0.0.1');
  const http=require('node:http'),{io:connect}=require('socket.io-client'),sockets=require('../socket'),server=http.createServer();
  const lookups=[],clients=[],io=await sockets.init(server,{adapterKey:`socket-queue-test:${process.pid}:${Date.now()}`,
    eventDB:{query(){return new Promise(resolve=>lookups.push(()=>resolve({rowCount:1})));}}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    for(let n=0;n<2;n++) {
      const client=connect(`http://127.0.0.1:${server.address().port}`,{transports:['websocket'],forceNew:true,reconnection:false});clients.push(client);
      await new Promise((resolve,reject)=>{client.once('connect',resolve);client.once('connect_error',reject);});
    }
    const replies=clients.flatMap((client,offset)=>Array.from({length:5},(_,index)=>new Promise(resolve=>client.emit('joinEventRoom',String(offset*5+index+1),resolve))));
    await new Promise(resolve=>setTimeout(resolve,50));assert.equal(lookups.length,8,'room requests cannot create an unbounded database queue');
    clients[0].emit('leaveEventRoom','1');await new Promise(resolve=>setTimeout(resolve,20));
    for(const finish of lookups) finish();
    const results=await Promise.all(replies);assert.equal(results[0].ok,false);assert.equal(results.filter(reply=>reply.ok).length,7);
  } finally {for(const client of clients) client.close();await io.shutdown();}
});
