const pool = require('../config/db');
const editable = ['title','description','category','starts_at','ends_at','latitude','longitude','location_address','status'];
const select = `SELECT e.*, p.username AS author_name,
  (SELECT count(*)::integer FROM bookmarks b WHERE b.event_id=e.id) bookmarks_count,
  (SELECT min(o.starts_at) FROM event_occurrences o WHERE o.event_id=e.id
    AND o.status='scheduled' AND o.starts_at>=now()) next_start
  FROM events e JOIN profiles p ON p.id=e.user_id`;
module.exports = {
  getAll: () => pool.query(`${select} ORDER BY e.id ASC`),
  getById: id => pool.query(`${select} WHERE e.id=$1`, [id]),
  create: ({ user_id, title, description, category, lat, lng, location_address, starts_at, ends_at, source='internal', place_id }) =>
    pool.query(`INSERT INTO events(user_id,title,description,category,latitude,longitude,location_address,starts_at,ends_at,source,data)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb) RETURNING *`,
    [user_id,title,description,category,lat,lng,location_address,starts_at,ends_at,source,JSON.stringify(place_id?{place_id}:{})]),
  delete: id => pool.query('DELETE FROM events WHERE id=$1 RETURNING *', [id]),
  async update({ id, actor_id, version, ...input }) {
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('eventmap.actor_id',$1,true)",[String(actor_id||'')]);
      const {rows:[before]} = await db.query('SELECT * FROM events WHERE id=$1 FOR UPDATE', [id]);
      if (!before) { await db.query('ROLLBACK'); return {rows:[],rowCount:0}; }
      if (version != null && String(version)!==String(before.version)) throw Object.assign(new Error('This event changed. Reopen it before saving.'),{status:409});
      const fields = editable.filter(field => Object.hasOwn(input,field));
      const changed = fields.filter(field => ['starts_at','ends_at'].includes(field)
        ? +(new Date(before[field])) !== +(new Date(input[field]))
        : String(before[field]??'') !== String(input[field]??''));
      const data = {...before.data};
      if (Object.hasOwn(input,'place_id')) data.place_id=input.place_id || null;
      if (before.source==='external') data.editor_overrides=[...new Set([...(data.editor_overrides||[]),...changed])];
      const parameters=fields.map(field=>input[field]);
      parameters.push(JSON.stringify(data),id);
      const result=await db.query(`UPDATE events SET ${fields.map((field,i)=>`${field}=$${i+1},`).join('')}
        data=$${fields.length+1}::jsonb,version=version+1,updated_at=now() WHERE id=$${fields.length+2} RETURNING *`,parameters);
      await db.query('INSERT INTO event_edit_history(event_id,actor_id,action,changed_fields) VALUES($1,$2,$3,$4)',[id,actor_id||null,'update',changed]);
      await db.query('COMMIT'); return result;
    } catch(error) { await db.query('ROLLBACK'); throw error; }
    finally { db.release(); }
  },
};
