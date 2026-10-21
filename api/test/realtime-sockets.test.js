const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Pool}=require('pg');
const {io:connect}=require('socket.io-client');
const sockets=require('../socket');
function received(socket,event,timeout=5000) {
  return new Promise((resolve,reject)=>{
    const handler=value=>{clearTimeout(timer);resolve(value);};
    const timer=setTimeout(()=>{socket.off(event,handler);reject(new Error(`Timed out: ${event}`));},timeout);
    socket.once(event,handler);
  });
}
test('separate API instances share event rooms and private notifications; reconnect rejoins',
  {skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');assert.equal(process.env.REDIS_HOST,'127.0.0.1');
  const schema=`socket_test_${process.pid}`;
  const admin=new Pool({max:1}),db=new Pool({max:2,options:`-c search_path=${schema}`}),servers=[],clients=[];
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    const {rows:[owner]}=await db.query("INSERT INTO profiles(username) VALUES($1) RETURNING id",[`socket_test_${process.pid}`]);
    const {rows:[event]}=await db.query("INSERT INTO events(user_id,title,source) VALUES($1,'Socket test','internal') RETURNING id",[owner.id]);
    for(let index=0;index<2;index++) {
      const server=http.createServer();
      const io=await sockets.init(server,{eventDB:db,adapterKey:`test:${process.pid}`,verifyIdentity:async token=>({uid:token,email_verified:true,exp:Math.floor(Date.now()/1000)+60}),profileByUid:async uid=>({id:uid==='reader'?10:20})});
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(io);
      const socket=connect(`http://127.0.0.1:${server.address().port}`,{transports:index?['polling']:['websocket'],forceNew:true,auth:{token:index?'outsider':'reader'}});
      clients.push(socket);await received(socket,'connect');
      const joined=await socket.timeout(3000).emitWithAck('joinEventRoom',event.id);assert.equal(joined.ok,true);
    }
    await new Promise(resolve=>setTimeout(resolve,100));
    const next=received(clients[1],'comments:changed');servers[0].to(`event_${event.id}`).emit('comments:changed',{eventId:event.id,revision:1});assert.equal((await next).revision,1);
    let leaked=false;clients[1].on('notification:changed',()=>{leaked=true;});
    const privateMessage=received(clients[0],'notification:changed');servers[1].to('user_10').emit('notification:changed',{id:123});assert.equal((await privateMessage).id,123);
    await new Promise(resolve=>setTimeout(resolve,100));assert.equal(leaked,false);
    clients[1].disconnect();clients[1].connect();await received(clients[1],'connect');
    const joined=await clients[1].timeout(3000).emitWithAck('joinEventRoom',event.id);assert.equal(joined.ok,true);
    const restored=received(clients[1],'comments:changed');servers[0].to(`event_${event.id}`).emit('comments:changed',{eventId:event.id,revision:2});assert.equal((await restored).revision,2);
    const rejected=await clients[1].timeout(3000).emitWithAck('joinEventRoom','user_10');assert.equal(rejected.ok,false);
  } finally {
    for(const client of clients) client.close();
    for(const io of servers) await io.shutdown();
    await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();
  }
});
