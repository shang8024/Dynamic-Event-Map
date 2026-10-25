const {createEventModel}=require('../models/eventModel');
const {publicEvent}=require('./publicEvents');
const {prepareEventInput}=require('./eventSchedule');
const {validateEvent}=require('./eventPermissions');
const {authenticated,administrator,activeAdministrator,requireAdministrator}=require('./moderationAccess');
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function identifier(value) {
  if(!/^[1-9]\d{0,17}$/.test(String(value??''))) fail(400,'Invalid publication ID.');
  return String(value);
}
const columns='id,user_id,event_id,draft,status,review_note,created_at,reviewed_at';
function createEventPublications(pool) {
  const events=createEventModel(pool);
  async function notify(db,userId,request,kind,title,message) {
    const {rows:[notice]}=await db.query(`INSERT INTO in_app_notifications(user_id,event_id,publication_id,kind,title,message,activity_key)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(user_id,activity_key) DO NOTHING RETURNING id`,
    [userId,request.event_id||null,request.id,kind,title,message,`publication:${request.id}:${kind}`]);
    if(notice) await db.query("INSERT INTO realtime_outbox(room,event,payload) VALUES($1,'notification:changed',$2::jsonb)",
      [`user_${userId}`,JSON.stringify({id:notice.id})]);
  }
  return {
    async submit(input) {
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        // Serialize first submissions with approvals. Pending/rejected requests
        // never unlock publishing, even with concurrent requests or deletions.
        const {rows:[owner]}=await db.query('SELECT id,role,first_event_approved_at,disabled_at FROM profiles WHERE id=$1 FOR UPDATE',[input.user_id]);
        if(!owner||owner.disabled_at) fail(403,'This account cannot publish events.');
        const fields=['title','description','category','latitude','longitude','location_address','starts_at','ends_at','place_id','occurrences','submission','organizer_name','image'];
        const draft=Object.fromEntries(fields.filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]));
        if(owner.role==='admin'||owner.first_event_approved_at) {
          const result=await events.create({...draft,user_id:owner.id,lat:draft.latitude,lng:draft.longitude,source:'internal'},db);
          await db.query('COMMIT');return result;
        }
        const {rows:[count]}=await db.query("SELECT count(*)::integer total FROM event_publication_requests WHERE user_id=$1 AND status='pending'",[owner.id]);
        if(count.total>=10) fail(409,'You already have 10 events waiting for review.');
        const {rows:[request]}=await db.query(`INSERT INTO event_publication_requests(user_id,draft) VALUES($1,$2::jsonb) RETURNING ${columns}`,[owner.id,JSON.stringify(draft)]);
        const {rows:admins}=await db.query("SELECT id FROM profiles WHERE role='admin' AND disabled_at IS NULL AND id<>$1",[owner.id]);
        for(const admin of admins) await notify(db,admin.id,request,'publication_submitted','A first event needs review',`Review ${draft.title} before it appears on the map.`);
        await db.query('COMMIT');
        return {rows:[{submission_id:request.id,publication_status:'pending'}]};
      } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
    },
    async list(user,{review=false,before=null}={}) {
      authenticated(user);
      if(review) await requireAdministrator(pool,user);
      if(before!==null) identifier(before);
      const {rows}=await pool.query(`SELECT ${columns} FROM event_publication_requests
        WHERE (($1::boolean AND status='pending') OR (NOT $1::boolean AND user_id=$2))
        AND ($3::bigint IS NULL OR id<$3) ORDER BY id DESC LIMIT 30`,[review,user.id,before]);
      return {items:rows,next:rows.length===30?rows.at(-1).id:null};
    },
    async get(id,user) {
      authenticated(user);identifier(id);
      const {rows:[row]}=await pool.query(`SELECT ${columns} FROM event_publication_requests WHERE id=$1 AND
        (user_id=$2 OR ($3::boolean AND EXISTS(SELECT 1 FROM profiles moderator WHERE moderator.id=$2 AND moderator.role='admin' AND moderator.disabled_at IS NULL)))`,[id,user.id,user.role==='admin']);
      if(!row) fail(404,'Submission not found');
      return row;
    },
    async published(user,{before=null}={}) {
      authenticated(user);if(before!==null) identifier(before);
      const {rows}=await pool.query(`SELECT id,title,category,status,starts_at,ends_at,created_at,archived_at,data FROM events
        WHERE user_id=$1 AND source='internal' AND ($2::bigint IS NULL OR id<$2) ORDER BY id DESC LIMIT 30`,[user.id,before]);
      return {items:rows.map(publicEvent),next:rows.length===30?rows.at(-1).id:null};
    },
    async review(id,user,{decision,note=''}={}) {
      authenticated(user);identifier(id);
      administrator(user);
      if(!['approve','reject'].includes(decision)) fail(400,'Choose approve or reject.');
      if(typeof note!=='string'||note.length>2000||decision==='reject'&&!note.trim()) fail(400,'Include a review reason in 1 to 2000 characters.');
      note=note.trim();
      const db=await pool.connect();
      try {
        await db.query('BEGIN');
        await requireAdministrator(db,user);
        const {rows:[lookup]}=await db.query('SELECT user_id FROM event_publication_requests WHERE id=$1',[id]);
        if(!lookup) fail(404,'Submission not found');
        // Lock both profiles in ID order: two administrators reviewing each
        // other's submissions cannot deadlock through opposite profile order.
        const {rows:profiles}=await db.query('SELECT id,role,disabled_at FROM profiles WHERE id=ANY($1::integer[]) ORDER BY id FOR NO KEY UPDATE',[[lookup.user_id,user.id]]);
        if(!activeAdministrator(profiles.find(profile=>String(profile.id)===String(user.id)))) fail(403,'Administrator access required');
        const owner=profiles.find(profile=>String(profile.id)===String(lookup.user_id));
        const {rows:[request]}=await db.query(`SELECT ${columns} FROM event_publication_requests WHERE id=$1 FOR UPDATE`,[id]);
        if(!owner||!request) fail(404,'Submission not found');
        if(request.status!=='pending') fail(409,'This submission has already been reviewed.');
        if(String(request.user_id)===String(user.id)) fail(403,'Another administrator must review your own submission.');
        let event=null;
        if(decision==='approve') {
          if(owner.disabled_at) fail(409,'This account cannot publish events.');
          const draft=prepareEventInput(request.draft),error=validateEvent(draft);
          if(error) fail(400,error);
          if(draft.ends_at&&Date.parse(draft.ends_at)<=Date.now()) fail(409,'This event has already ended. Reject it with a reason.');
          event=(await events.create({...draft,user_id:owner.id,source:'internal',lat:draft.latitude,lng:draft.longitude},db)).rows[0];
          await db.query('UPDATE profiles SET first_event_approved_at=COALESCE(first_event_approved_at,now()) WHERE id=$1',[owner.id]);
        }
        const status=decision==='approve'?'approved':'rejected';
        const {rows:[updated]}=await db.query(`UPDATE event_publication_requests SET status=$2,event_id=$3,reviewer_id=$4,review_note=$5,reviewed_at=now()
          WHERE id=$1 RETURNING ${columns}`,[id,status,event?.id||null,user.id,note]);
        await notify(db,owner.id,updated,`publication_${status}`,status==='approved'?'Your event was published':'Your event was rejected',
          `${request.draft.title} ${status==='approved'?'is now published on the map.':'was not published.'}${note?`\n\n${note}`:''}`);
        await db.query('INSERT INTO event_edit_history(event_id,actor_id,action,changed_fields) VALUES($1,$2,$3,$4)',[event?.id||null,user.id,`publication_${status}`,['publication_status']]);
        if(event) await db.query("INSERT INTO realtime_outbox(event,payload) VALUES('event:created',$1::jsonb)",[JSON.stringify(publicEvent(event))]);
        await db.query('COMMIT');return updated;
      } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
    },
  };
}
module.exports={createEventPublications,identifier};
