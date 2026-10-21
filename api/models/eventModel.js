const {prepareEventInput}=require('../services/eventSchedule');
const editable = ['title','description','category','starts_at','ends_at','latitude','longitude','location_address','status'];
const select = `SELECT e.*, p.username AS author_name,
  (SELECT count(*)::integer FROM bookmarks b WHERE b.event_id=e.id) bookmarks_count,
  (SELECT min(o.starts_at) FROM event_occurrences o WHERE o.event_id=e.id
    AND o.status='scheduled' AND o.starts_at>=now()) next_start,
  (SELECT row_to_json(o) FROM event_occurrences o WHERE o.event_id=e.id AND o.status='scheduled'
    AND (o.starts_at>=now() OR o.ends_at>now()) ORDER BY CASE WHEN o.starts_at<=now() AND o.ends_at>now() THEN 0 ELSE 1 END,o.starts_at LIMIT 1) next_occurrence,
  (SELECT COALESCE(jsonb_agg(jsonb_build_object('key',CASE WHEN o.source_key LIKE 'manual:%' THEN substr(o.source_key,8) ELSE o.source_key END,
    'starts_at',o.starts_at,'ends_at',o.ends_at) ORDER BY o.starts_at),'[]'::jsonb)
    FROM event_occurrences o WHERE o.event_id=e.id AND o.status='scheduled') occurrences
  FROM events e JOIN profiles p ON p.id=e.user_id`;
function createEventModel(pool) { return {
  getAll: () => pool.query(`${select} WHERE e.archived_at IS NULL AND (e.ends_at IS NULL OR e.ends_at>now()) ORDER BY e.id ASC`),
  getById: id => pool.query(`${select} WHERE e.id=$1`, [id]),
  async create(input) {
    const value=prepareEventInput({...input,occurrences:input.occurrences||[{starts_at:input.starts_at,ends_at:input.ends_at}]});
    const {user_id,title,description,category,lat,lng,location_address,starts_at,ends_at,source='internal',place_id,occurrences}=value;
    const db=await pool.connect();
    try {
      await db.query('BEGIN');
      const result=await db.query(`INSERT INTO events(user_id,title,description,category,latitude,longitude,location_address,starts_at,ends_at,source,data)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
      [user_id,title,description,category,lat,lng,location_address,starts_at,ends_at,source,
        JSON.stringify({...(place_id?{place_id}:{}),occurrences,schedule_origin:'manual',schedule_format:2})]);
      await db.query('SELECT refresh_event_occurrences($1)',[result.rows[0].id]);
      await db.query('COMMIT');return result;
    } catch(error) {await db.query('ROLLBACK');throw error;} finally {db.release();}
  },
  delete: id => pool.query('DELETE FROM events WHERE id=$1 RETURNING *', [id]),
  async update({ id, actor_id, version, ...input }) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('eventmap.actor_id',$1,true)",[String(actor_id||'')]);
      const {rows:[before]} = await db.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [id]);
      if (!before) { await db.query('ROLLBACK'); return {rows:[],rowCount:0}; }
      if (before.archived_at) throw Object.assign(new Error('This event is archived and cannot be edited.'),{status:410});
      if (version != null && String(version)!==String(before.version)) throw Object.assign(new Error('This event changed. Reopen it before saving.'),{status:409});
      input=prepareEventInput(input);
      const fields = editable.filter(field => Object.hasOwn(input,field));
      const changed = fields.filter(field => ['starts_at','ends_at'].includes(field)
        ? +(new Date(before[field])) !== +(new Date(input[field]))
        : String(before[field]??'') !== String(input[field]??''));
      const data = {...before.data};
      if(Object.hasOwn(input,'occurrences') || changed.some(field=>['starts_at','ends_at'].includes(field))) {
        if(!input.occurrences && (before.data.occurrences?.length||0)>1) throw Object.assign(new Error('Edit the individual occurrences to change this schedule.'),{status:400});
        const schedule=prepareEventInput({occurrences:input.occurrences||[{starts_at:input.starts_at||before.starts_at.toISOString(),ends_at:Object.hasOwn(input,'ends_at')?input.ends_at:before.ends_at?.toISOString()}]});
        data.occurrences=schedule.occurrences;data.schedule_origin='manual';data.schedule_format=2;
        changed.push('occurrences');
      }
      if (Object.hasOwn(input,'place_id')) data.place_id=input.place_id || null;
      if (before.source==='external') data.editor_overrides=[...new Set([...(data.editor_overrides||[]),...changed,
        ...(data.schedule_origin==='manual'?['occurrences','starts_at','ends_at']:[])])];
      const parameters=fields.map(field=>input[field]);
      parameters.push(JSON.stringify(data),id);
      const result=await db.query(`UPDATE events SET ${fields.map((field,i)=>`${field}=$${i+1},`).join('')}
        data=$${fields.length+1}::jsonb,version=version+1,updated_at=now() WHERE id=$${fields.length+2} RETURNING *`,parameters);
      await db.query('INSERT INTO event_edit_history(event_id,actor_id,action,changed_fields) VALUES($1,$2,$3,$4)',[id,actor_id||null,'update',changed]);
      await db.query('SELECT refresh_event_occurrences($1)',[id]);
      await db.query('COMMIT'); return result;
    } catch(error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  },
}; }
module.exports=createEventModel(require('../config/db'));
module.exports.createEventModel=createEventModel;
