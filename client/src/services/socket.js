import {io} from 'socket.io-client';
import {socketEndpoint} from './endpoints';
import {getVerifiedIdToken} from './authToken';
const {url,path}=socketEndpoint(import.meta.env.VITE_API_BASE_URL??'/api',window.location.origin);
const socket=io(url,{path,transports:['polling','websocket'],reconnection:true,reconnectionDelay:1000,
  reconnectionDelayMax:10000,randomizationFactor:0.5,reconnectionAttempts:Infinity,timeout:15000,
  auth:callback=>{getVerifiedIdToken().then(token=>callback({token:token||undefined})).catch(()=>callback({}));}});
const wakeListeners=new Set();
function wake() {if(navigator.onLine && !socket.connected) socket.connect();for(const handler of wakeListeners) handler();}
window.addEventListener('online',wake);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible') wake();});
socket.on('connect',()=>{for(const handler of wakeListeners) handler();});
socket.on('session:expired',()=>{socket.disconnect();socket.connect();});
export function onRealtimeWake(handler) {wakeListeners.add(handler);return()=>wakeListeners.delete(handler);}
export function refreshSocketIdentity() {socket.disconnect();socket.connect();}
export function subscribeEvent(eventId,onSync,onChange) {
  let active=true;
  const joined=()=>{
    if(!socket.connected) return;
    socket.timeout(5000).emit('joinEventRoom',eventId,(error,result)=>{if(active && !error && result?.ok) onSync();});
  };
  const changed=payload=>{if(active && String(payload.eventId)===String(eventId)) onChange(payload);};
  socket.on('connect',joined);socket.on('comments:changed',changed);
  const stopWake=onRealtimeWake(()=>{if(document.visibilityState==='visible') onSync();});
  joined();
  return()=>{active=false;socket.off('connect',joined);socket.off('comments:changed',changed);stopWake();
    if(socket.connected) socket.emit('leaveEventRoom',eventId);};
}
export default socket;
export const on=(event,cb)=>socket.on(event,cb);
export const off=(event,cb)=>socket.off(event,cb);
export const emit=(event,payload)=>socket.emit(event,payload);
