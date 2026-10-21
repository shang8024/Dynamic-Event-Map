const Event=require('../models/eventModel');
const socket=require('../socket');
const {bumpEventCount}=require('./statsController');
const {canManageEvent,validateEvent}=require('../services/eventPermissions');
function broadcast(name,payload) { try {socket.getIO().emit(name,payload);} catch {/* HTTP data remains authoritative. */} }
function fail(res,error) {
  console.error('Event operation failed',error.code || error.name);
  return res.status(error.status||500).json({error:error.status?error.message:'Unable to save the event. Please try again.'});
}
async function getEvents(_req,res) {
  try {res.json((await Event.getAll()).rows);} catch(error) {fail(res,error);}
}
async function createEvent(req,res) {
  if(!req.user) return res.status(401).json({error:'Authentication required'});
  if(req.body.source && req.body.source!=='internal') return res.status(403).json({error:'External events can only be created by the import job'});
  const error=validateEvent(req.body);
  if(error) return res.status(400).json({error});
  try {
    const row=(await Event.create({...req.body,lat:Number(req.body.latitude),lng:Number(req.body.longitude),user_id:req.user.id,source:'internal'})).rows[0];
    await bumpEventCount(1); broadcast('event:created',row); res.json(row);
  } catch(error) {fail(res,error);}
}
async function updateEvent(req,res) {
  if(!req.user) return res.status(401).json({error:'Authentication required'});
  try {
    const before=(await Event.getById(req.params.id)).rows[0];
    if(!before) return res.status(404).json({error:'Event not found'});
    if(!canManageEvent(req.user,before)) return res.status(403).json({error:'You cannot edit this event'});
    const error=validateEvent(req.body,before);
    if(error) return res.status(400).json({error});
    const input=Object.fromEntries(['title','description','category','starts_at','ends_at','latitude','longitude','location_address','status','place_id','version']
      .filter(field=>Object.hasOwn(req.body,field)).map(field=>[field,req.body[field]]));
    const row=(await Event.update({...input,id:before.id,actor_id:req.user.id})).rows[0];
    await bumpEventCount(0); broadcast('event:updated',row); res.json(row);
  } catch(error) {fail(res,error);}
}
async function deleteEvent(req,res) {
  if(!req.user) return res.status(401).json({error:'Authentication required'});
  try {
    const row=(await Event.getById(req.params.id)).rows[0];
    if(!row) return res.status(404).json({error:'Event not found'});
    if(!canManageEvent(req.user,row)) return res.status(403).json({error:'You cannot delete this event'});
    if(row.source==='external') {
      const cancelled=(await Event.update({id:row.id,status:'cancelled',actor_id:req.user.id})).rows[0];
      broadcast('event:updated',cancelled); return res.json({message:'Event cancelled',event:cancelled});
    }
    await Event.delete(row.id); await bumpEventCount(-1); broadcast('event:deleted',{id:row.id});
    res.json({message:'Event deleted'});
  } catch(error) {fail(res,error);}
}
module.exports={getEvents,createEvent,updateEvent,deleteEvent};
