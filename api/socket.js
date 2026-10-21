let defaultIO=null;
async function init(server,options={}) {
  const {Server}=require('socket.io');
  const {createAdapter}=require('@socket.io/redis-adapter');
  const {createClient}=require('redis');
  const fs=require('node:fs');
  const origins=(process.env.ALLOWED_ORIGINS||`http://localhost:${process.env.FRONTEND_PORT||3000},http://localhost`).split(',').map(value=>value.trim());
  const io=new Server(server,{cors:{origin:origins,credentials:false},path:'/socket.io/',transports:['polling','websocket'],maxHttpBufferSize:16000});
  const password=process.env.REDIS_PASSWORD_FILE?fs.readFileSync(process.env.REDIS_PASSWORD_FILE,'utf8').trim():process.env.REDIS_PASSWORD;
  const pubClient=createClient({socket:{host:process.env.REDIS_HOST||'redis',port:Number(process.env.REDIS_PORT||6379),reconnectStrategy:attempt=>Math.min(1000+attempt*250,10000)},password,database:1,disableOfflineQueue:true});
  const subClient=pubClient.duplicate();
  defaultIO=io;
  for(const client of [pubClient,subClient]) client.on('error',error=>console.error('Realtime Redis unavailable',error.code||error.name));
  await Promise.all([pubClient.connect(),subClient.connect()]);
  io.adapter(createAdapter(pubClient,subClient));
  io.realtimeReady=()=>pubClient.isReady && subClient.isReady;
  io.use(async(socket,next)=>{
    try {
      const token=socket.handshake.auth?.token;
      if(token) {
        const identity=await (options.verifyIdentity ? options.verifyIdentity(token) : require('./config/firebaseAdmin').auth().verifyIdToken(token));
        if(identity.email_verified!==true) return next(new Error('Verified sign-in required'));
        const user=await (options.profileByUid ? options.profileByUid(identity.uid) : require('./models/user').findOne({where:{google_id:identity.uid}}));
        if(!user) return next(new Error('Finish signing in first'));
        socket.data.userId=user.id;
        socket.data.expiresAt=identity.exp*1000;
      }
      next();
    } catch {next(new Error('Sign in again to restore private notifications'));}
  });
  io.on('connection',socket=>{
    if(socket.data.userId) socket.join(`user_${socket.data.userId}`);
    const expiry=socket.data.expiresAt?setTimeout(()=>{
      socket.emit('session:expired');socket.disconnect(true);
    },Math.max(0,socket.data.expiresAt-Date.now())):null;
    const joined=new Set();let joins=0,windowStart=Date.now();
    socket.on('joinEventRoom',async(eventId,ack)=>{
      if(Date.now()-windowStart>60000) {joins=0;windowStart=Date.now();}
      if(++joins>60 || !/^\d{1,10}$/.test(String(eventId)) || joined.size>=5) return typeof ack==='function'&&ack({ok:false});
      try {
        const exists=await (options.db||require('./config/db')).query('SELECT 1 FROM events WHERE id=$1',[eventId]);
        if(!exists.rowCount) return typeof ack==='function'&&ack({ok:false});
        await socket.join(`event_${eventId}`);joined.add(String(eventId));
        if(typeof ack==='function') ack({ok:true,eventId:String(eventId)});
      } catch {if(typeof ack==='function') ack({ok:false});}
    });
    socket.on('leaveEventRoom',eventId=>{
      if(!/^\d{1,10}$/.test(String(eventId))) return;
      joined.delete(String(eventId));socket.leave(`event_${eventId}`);
    });
    socket.on('disconnect',()=>{if(expiry) clearTimeout(expiry);});
  });
  const stop=options.db?require('./services/realtimeOutbox').startRealtimeOutbox({db:options.db,io}):()=>{};
  io.shutdown=async()=>{stop();await io.close();await Promise.all([pubClient.quit(),subClient.quit()]);};
  return io;
}
function isReady() {return Boolean(defaultIO?.realtimeReady?.());}
function getIO() {if(!defaultIO) throw new Error('Realtime server is not initialized');return defaultIO;}
async function close() {if(defaultIO) await defaultIO.shutdown();}
module.exports={init,getIO,isReady,close};
