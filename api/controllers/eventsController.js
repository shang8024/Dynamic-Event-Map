const Event=require('../models/eventModel');
const socket=require('../socket');
const {bumpEventCount}=require('./statsController');
const {canManageEvent,validateEvent,validateEventSubmission}=require('../services/eventPermissions');
const {prepareEventInput}=require('../services/eventSchedule');
const {publicEvent}=require('../services/publicEvents');
function broadcast(name,payload) { try {socket.getIO().emit(name,payload);} catch {/* HTTP data remains authoritative. */} }
function fail(res,error) {
  console.error('Event operation failed',error.code || error.name);
  if(error.code?.startsWith('IMAGE_')) return res.status(422).json(require('../services/imageErrors').publicImageError(error));
  return res.status(error.status||500).json({error:error.status?error.message:'Unable to save the event. Please try again.'});
}
async function getEvents(_req,res) {
  try {res.json((await Event.getAll()).rows.map(publicEvent));} catch(error) {fail(res,error);}
}
async function getEvent(req,res) {
  res.set('Cache-Control','no-store');
  const id=String(req.params.id);
  if(!/^[1-9]\d{0,9}$/.test(id)||Number(id)>2147483647) return res.status(400).json({error:'Invalid event ID'});
  try {
    const row=(await Event.getById(id)).rows[0];
    if(!row) return res.status(404).json({error:'Event not found'});
    res.json(publicEvent(row));
  } catch {res.status(503).json({error:'Unable to load event. Please try again.'});}
}
async function createEvent(req,res) {
  if(!req.user) return res.status(401).json({error:'Authentication required'});
  if(req.body.source && req.body.source!=='internal') return res.status(403).json({error:'External events can only be created by the import job'});
  try {
    const input=prepareEventInput(req.body),error=validateEventSubmission(input)||validateEvent(input);
    if(error) return res.status(400).json({error});
    const submission={role:input.submission_role,
      ...(input.submission_role==='organizer'?{organizer_confirmed_at:new Date().toISOString()}:{})};
    const image=input.image==null?null:(await require('../services/eventPhotoInput').preparePhoto(input.image)).image;
    const row=(await Event.submit({...input,latitude:Number(input.latitude),longitude:Number(input.longitude),user_id:req.user.id,source:'internal',submission,image})).rows[0];
    if(row.publication_status==='pending') return res.json({publication_status:'pending',submission_id:row.submission_id});
    const output=publicEvent(row);
    await bumpEventCount(1); broadcast('event:created',output); res.json(output);
  } catch(error) {fail(res,error);}
}
async function updateEvent(req,res) {
  if(!req.user) return res.status(401).json({error:'Authentication required'});
  try {
    const before=(await Event.getById(req.params.id)).rows[0];
    if(!before) return res.status(404).json({error:'Event not found'});
    if(!canManageEvent(req.user,before)) return res.status(403).json({error:'You cannot edit this event'});
    const prepared=prepareEventInput(req.body),error=validateEvent(prepared,before);
    if(error) return res.status(400).json({error});
    const input=Object.fromEntries(['title','description','category','starts_at','ends_at','latitude','longitude','location_address','status','place_id','version','occurrences','organizer_name']
      .filter(field=>Object.hasOwn(prepared,field)).map(field=>[field,prepared[field]]));
    const row=(await Event.update({...input,id:before.id,actor_id:req.user.id})).rows[0];
    const output=publicEvent(row);
    await bumpEventCount(0); broadcast('event:updated',output); res.json(output);
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
      const output=publicEvent(cancelled);
      broadcast('event:updated',output); return res.json({message:'Event cancelled',event:output});
    }
    await Event.delete(row.id); await bumpEventCount(-1); broadcast('event:deleted',{id:row.id});
    res.json({message:'Event deleted'});
  } catch(error) {fail(res,error);}
}
module.exports={getEvents,getEvent,createEvent,updateEvent,deleteEvent};
