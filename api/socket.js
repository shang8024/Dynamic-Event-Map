let defaultIO=null;
async function init(server,options={}) {
  const {Server}=require('socket.io');
  const {createAdapter}=require('@socket.io/redis-adapter');
  const {createClient}=require('redis');
  const {bounded}=require('./services/requestLimits');
  const {accountAccessReason}=require('./services/accountAccess');
  const fs=require('node:fs');
  const origins=(process.env.ALLOWED_ORIGINS||`http://localhost:${process.env.FRONTEND_PORT||3000},http://localhost`).split(',').map(value=>value.trim());
  let admission,roomLookups=0;
  const io=new Server(server,{cors:{origin:origins,credentials:false},path:'/socket.io/',transports:['polling','websocket'],maxHttpBufferSize:16000,connectTimeout:10000,
    allowRequest:async(req,callback)=>{
      if(req.headers.origin && !origins.includes(req.headers.origin)) return callback('Origin not allowed',false);
      const lease=await admission?.acquire(req);
      if(!lease) return callback('Connection limit reached. Please try again later.',false);
      req.eventmapAdmission=lease;callback(null,true);
    }});
  const password=process.env.REDIS_PASSWORD_FILE?fs.readFileSync(process.env.REDIS_PASSWORD_FILE,'utf8').trim():process.env.REDIS_PASSWORD;
  const pubClient=createClient({socket:{host:process.env.REDIS_HOST||'redis',port:Number(process.env.REDIS_PORT||6379),reconnectStrategy:attempt=>Math.min(1000+attempt*250,10000)},password,database:1,disableOfflineQueue:true});
  const subClient=pubClient.duplicate();
  defaultIO=io;
  for(const client of [pubClient,subClient]) client.on('error',error=>console.error('Realtime Redis unavailable',error.code||error.name));
  await Promise.all([pubClient.connect(),subClient.connect()]);
  admission=require('./services/socketAdmission').createSocketAdmission(pubClient,{prefix:`${options.adapterKey||'eventmap:v1'}:admission`,...options.admission});
  io.engine.on('connection',connection=>admission.attach(connection));
  io.engine.on('connection_error',error=>{void admission.release(error.req?.eventmapAdmission);});
  io.adapter(createAdapter(pubClient,subClient,{key:options.adapterKey||'eventmap:v1'}));
  io.realtimeReady=()=>pubClient.isReady && subClient.isReady;
  io.use(async(socket,next)=>{
    try {
      const token=socket.handshake.auth?.token;
      if(token) {
        const identity=await bounded(options.verifyIdentity ? options.verifyIdentity(token) : require('./config/firebaseAdmin').auth().verifyIdToken(token),2000);
        if(identity.email_verified!==true) return next(new Error('Verified sign-in required'));
        const profile=()=>bounded(options.profileByUid ? options.profileByUid(identity.uid) : require('./models/user').findOne({where:{google_id:identity.uid}}),2000);
        const user=await profile();
        if(!user) return next(new Error('Finish signing in first'));
        if(accountAccessReason(user,identity)) return next(new Error('Sign in again to restore private notifications'));
        if(!await admission.bindUser(socket.request.eventmapAdmission,user.id)) return next(new Error('Too many live sessions. Close another tab and try again.'));
        socket.request.eventmapAdmission.revalidate=async()=>{
          const current=await profile();
          return current?.id===user.id && !accountAccessReason(current,identity);
        };
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
    const joined=new Set(),joining=new Map();let joins=0,windowStart=Date.now();
    socket.on('joinEventRoom',async(eventId,ack)=>{
      if(Date.now()-windowStart>60000) {joins=0;windowStart=Date.now();}
      if(!/^[1-9]\d{0,9}$/.test(String(eventId)) || Number(eventId)>2147483647) return typeof ack==='function'&&ack({ok:false});
      if(joined.has(String(eventId))) return typeof ack==='function'&&ack({ok:true,eventId:String(eventId)});
      if(++joins>60 || joined.size+joining.size>=5 || joining.has(String(eventId))) return typeof ack==='function'&&ack({ok:false});
      const reservation=Symbol();joining.set(String(eventId),reservation);
      try {
        if(!await admission.allowJoin(socket.request.eventmapAdmission)) return typeof ack==='function'&&ack({ok:false});
        // Room subscriptions must not fill the entire shared database queue.
        if(roomLookups>=8) return typeof ack==='function'&&ack({ok:false});
        let exists;roomLookups++;
        try {exists=await (options.db||options.eventDB||require('./config/db')).query('SELECT 1 FROM events WHERE id=$1',[eventId]);}
        finally {roomLookups--;}
        if(!exists.rowCount || !socket.connected || joining.get(String(eventId))!==reservation) return typeof ack==='function'&&ack({ok:false});
        await socket.join(`event_${eventId}`);joined.add(String(eventId));
        if(typeof ack==='function') ack({ok:true,eventId:String(eventId)});
      } catch {if(typeof ack==='function') ack({ok:false});}
      finally {if(joining.get(String(eventId))===reservation) joining.delete(String(eventId));}
    });
    socket.on('leaveEventRoom',eventId=>{
      if(!/^\d{1,10}$/.test(String(eventId))) return;
      joining.delete(String(eventId));
      joined.delete(String(eventId));socket.leave(`event_${eventId}`);
    });
    socket.on('disconnect',()=>{if(expiry) clearTimeout(expiry);});
  });
  const stop=options.db?require('./services/realtimeOutbox').startRealtimeOutbox({db:options.db,io}):()=>{};
  io.shutdown=async()=>{stop();await admission.close();await io.close();await Promise.all([pubClient.quit(),subClient.quit()]);};
  return io;
}
function isReady() {return Boolean(defaultIO?.realtimeReady?.());}
function getIO() {if(!defaultIO) throw new Error('Realtime server is not initialized');return defaultIO;}
async function close() {if(defaultIO) await defaultIO.shutdown();}
module.exports={init,getIO,isReady,close};
