const {prepareEventInput}=require('./eventSchedule');
const {validateEvent}=require('./eventPermissions');
const {createEventModel}=require('../models/eventModel');
const {administrator,requireAdministrator}=require('./moderationAccess');

const EDITABLE=['title','description','category','latitude','longitude','location_address','place_id','organizer_name','occurrences'];
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function identifier(value) {
  const text=String(value??'');
  if(!/^[1-9]\d{0,17}$/.test(text)) fail(400,'Invalid submission ID.');
  return text;
}
function community(event) {return event?.source==='internal' && event.data?.submission?.role==='reporter';}
function active(event) {return event && !event.archived_at && event.status!=='cancelled' && (!event.ends_at||new Date(event.ends_at)>new Date());}
function cleanValue(event,key) {
  if(key==='occurrences') return event.data?.occurrences||[];
  if(key==='place_id') return event.data?.place_id||null;
  if(key==='organizer_name') return event.data?.organizer_name||'';
  return event[key]??null;
}
function prepareChanges(body,before) {
  if(!body || typeof body!=='object' || Array.isArray(body)) fail(400,'Check your proposed event changes.');
  const input=Object.fromEntries(EDITABLE.filter(key=>Object.hasOwn(body,key)).map(key=>[key,body[key]]));
  for(const key of ['title','description','location_address','organizer_name']) if(typeof input[key]==='string') input[key]=input[key].trim();
  for(const key of ['latitude','longitude']) if(Object.hasOwn(input,key) && input[key]!==null && input[key]!=='') input[key]=Number(input[key]);
  const prepared=prepareEventInput(input),error=validateEvent(prepared,before);
  if(error) fail(400,error);
  if(Object.hasOwn(input,'category') && (typeof input.category!=='string'||input.category.length>100)) fail(400,'Check your proposed event changes.');
  const changes={},original_values={};
  for(const key of Object.keys(input)) {
    const next=key==='occurrences'?prepared.occurrences:input[key],previous=cleanValue(before,key);
    if(JSON.stringify(next)!==JSON.stringify(previous)) {changes[key]=next;original_values[key]=previous;}
  }
  if(!Object.keys(changes).length) fail(400,'Change at least one event detail before submitting.');
  return {changes,original_values};
}
const fields=`r.id,r.event_id,r.submitter_id,r.event_title,r.base_version,r.changes,r.original_values,
  r.explanation,r.status,r.review_note,r.created_at,r.reviewed_at,p.username AS submitter_name,
  e.version AS event_version,e.archived_at AS event_archived_at`;
const select=`SELECT ${fields} FROM event_change_requests r JOIN profiles p ON p.id=r.submitter_id LEFT JOIN events e ON e.id=r.event_id`;
function createEventSuggestions(pool) {
  const events=createEventModel(pool);
  async function notify(db,{userId,eventId,requestId,kind,title,message}) {
    const {rows:[item]}=await db.query(`INSERT INTO in_app_notifications(user_id,event_id,suggestion_id,kind,title,message,activity_key)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,activity_key) DO NOTHING RETURNING id`,
    [userId,eventId,requestId,kind,title,message,`suggestion:${requestId}:${kind}`]);
    if(item) await db.query("INSERT INTO realtime_outbox(room,event,payload) VALUES($1,'notification:changed',$2::jsonb)",[ `user_${userId}`,JSON.stringify({id:item.id})]);
  }
  return {
    async submit(eventId,user,body) {
      if(!user?.id) fail(401,'Authentication required');
      identifier(eventId);
      if(BigInt(eventId)>2147483647n) fail(400,'Invalid event ID.');
      const explanation=typeof body?.explanation==='string'?body.explanation.trim():'';
      if(!explanation||explanation.length>2000) fail(400,'Explain your changes in 1 to 2000 characters.');
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        const {rows:[before]}=await db.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[eventId]);
        if(!before) fail(404,'Event not found');
        if(!community(before)) fail(403,'Community suggestions are available only for events shared by reporters.');
        if(!active(before)) fail(410,'This event has ended or been archived and cannot accept suggestions.');
        if(body.version==null||String(body.version)!==String(before.version)) fail(409,'This event changed. Reopen it before submitting a suggestion.');
        const {changes,original_values}=prepareChanges(body,before);
        // Serialize the per-user pending cap across requests for different events.
        await db.query('SELECT pg_advisory_xact_lock(42803,$1::integer)',[user.id]);
        const {rows:[pending]}=await db.query("SELECT count(*)::integer total FROM event_change_requests WHERE submitter_id=$1 AND status='pending'",[user.id]);
        if(pending.total>=10) fail(409,'You already have 10 suggestions waiting for review.');
        const {rows:[request]}=await db.query(`INSERT INTO event_change_requests(event_id,submitter_id,event_title,base_version,changes,original_values,explanation)
          VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7) RETURNING *`,[eventId,user.id,before.title,before.version,JSON.stringify(changes),JSON.stringify(original_values),explanation]);
        const {rows:admins}=await db.query("SELECT id FROM profiles WHERE role='admin' AND disabled_at IS NULL AND id<>$1",[user.id]);
        for(const admin of admins) await notify(db,{userId:admin.id,eventId,requestId:request.id,kind:'suggestion_submitted',
          title:'An event update needs review',message:`A community member suggested changes to ${before.title}. Review the submission before publishing it.`});
        await db.query('COMMIT');return request;
      } catch(error) {
        await db.query('ROLLBACK');
        if(error.code==='23505') fail(409,'You already have a suggestion waiting for review for this event.');
        throw error;
      } finally {db.release();}
    },
    async list(user,{review=false,before=null}={}) {
      if(!user?.id) fail(401,'Authentication required');
      if(review) await requireAdministrator(pool,user);
      if(before!==null) identifier(before);
      const {rows}=await pool.query(`${select} WHERE ((NOT $3::boolean AND r.submitter_id=$1) OR ($3::boolean AND r.status='pending'))
        AND ($2::bigint IS NULL OR r.id<$2) ORDER BY r.id DESC LIMIT 30`,[user.id,before,review]);
      return {items:rows,next:rows.length===30?rows.at(-1).id:null};
    },
    async get(id,user) {
      identifier(id);
      if(!user?.id) fail(401,'Authentication required');
      const {rows:[row]}=await pool.query(`${select} WHERE r.id=$1 AND
        (r.submitter_id=$2 OR ($3::boolean AND EXISTS(SELECT 1 FROM profiles moderator WHERE moderator.id=$2 AND moderator.role='admin' AND moderator.disabled_at IS NULL)))`,[id,user.id,user.role==='admin']);
      if(!row) fail(404,'Submission not found');
      return row;
    },
    async review(id,user,{decision,note=''}) {
      administrator(user);
      identifier(id);
      if(!['approve','reject'].includes(decision)) fail(400,'Choose approve or reject.');
      if(typeof note!=='string'||note.length>2000||decision==='reject'&&!note.trim()) fail(400,'Include a review reason in 1 to 2000 characters.');
      note=note.trim();
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        await requireAdministrator(db,user,{lock:true});
        const {rows:[lookup]}=await db.query('SELECT event_id FROM event_change_requests WHERE id=$1',[id]);
        if(!lookup) fail(404,'Submission not found');
        // Event before request: compatible with event deletion and parallel reviews.
        const before=lookup.event_id?(await db.query('SELECT * FROM events WHERE id=$1 FOR UPDATE',[lookup.event_id])).rows[0]:null;
        const {rows:[request]}=await db.query('SELECT * FROM event_change_requests WHERE id=$1 FOR UPDATE',[id]);
        if(!request) fail(404,'Submission not found');
        if(request.status!=='pending') fail(409,'This submission has already been reviewed.');
        if(String(request.submitter_id)===String(user.id)) fail(403,'Another administrator must review your own suggestion.');
        let event=null;
        if(decision==='approve') {
          if(!active(before)||!community(before)||String(before.id)!==String(request.event_id)) fail(409,'This event is no longer available for community changes.');
          if(String(before.version)!==String(request.base_version)) fail(409,'This event changed since submission. Reject this suggestion and ask for a new one.');
          const {changes}=prepareChanges(request.changes,before);
          await db.query('INSERT INTO event_contributors(event_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[before.id,request.submitter_id]);
          event=(await events.update({id:before.id,actor_id:user.id,version:request.base_version,...changes},db)).rows[0];
        }
        const status=decision==='approve'?'approved':'rejected';
        const {rows:[updated]}=await db.query(`UPDATE event_change_requests SET status=$2,reviewer_id=$3,review_note=$4,reviewed_at=now()
          WHERE id=$1 RETURNING *`,[id,status,user.id,note]);
        await notify(db,{userId:request.submitter_id,eventId:request.event_id,requestId:id,kind:`suggestion_${status}`,
          title:`Your event update was ${status}`,message:`Your suggested changes to ${request.event_title} were ${status}.${note?`\n\nReviewer’s note: ${note}`:''}`});
        // A hydrated event includes the newly approved contributor count and names.
        if(event) await db.query("INSERT INTO realtime_outbox(event,payload) VALUES('event:updated',$1::jsonb)",[JSON.stringify(event)]);
        await db.query('COMMIT');return updated;
      } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
    },
  };
}
module.exports={createEventSuggestions,prepareChanges,community,identifier};
