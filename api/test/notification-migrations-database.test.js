const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Client}=require('pg');

test('community notification migrations preserve existing import alerts and all supported notification kinds',
  {skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const db=new Client(),schema=`notification_upgrade_test_${process.pid}`;
  const directory=path.resolve(__dirname,'../../db/migrations');
  const files=(await fs.readdir(directory)).filter(file=>/^\d.*\.sql$/.test(file)).sort();
  const legacyKinds=['comment','event_updated','event_cancelled','ingest_alert'];
  await db.connect();
  try {
    await db.query(`CREATE SCHEMA ${schema}`);
    await db.query(`SET search_path TO ${schema}`);
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    for(const file of files.filter(file=>Number.parseInt(file,10)<10)) {
      await db.query(await fs.readFile(path.join(directory,file),'utf8'));
    }
    const {rows:[user]}=await db.query("INSERT INTO profiles(username,role) VALUES('notification-upgrade','admin') RETURNING id");
    const insert=kind=>db.query(`INSERT INTO in_app_notifications(user_id,kind,title,message,activity_key)
      VALUES($1,$2,'Notification','Retained message',$3)`,[user.id,kind,`upgrade:${kind}`]);
    for(const kind of legacyKinds) await insert(kind);
    const before=(await db.query('SELECT * FROM in_app_notifications ORDER BY id')).rows;
    for(const file of files.filter(file=>Number.parseInt(file,10)>=10)) {
      await db.query(await fs.readFile(path.join(directory,file),'utf8'));
    }
    assert.deepEqual((await db.query('SELECT * FROM in_app_notifications ORDER BY id')).rows,
      before.map(row=>({...row,suggestion_id:null})));
    await db.query('DELETE FROM in_app_notifications');
    const supported=[...legacyKinds,'suggestion_submitted','suggestion_approved','suggestion_rejected'];
    for(const kind of supported) await insert(kind);
    assert.deepEqual((await db.query('SELECT kind FROM in_app_notifications ORDER BY id')).rows.map(row=>row.kind),supported);
    await assert.rejects(()=>insert('unsupported_kind'),error=>error.code==='23514'
      && error.constraint==='in_app_notifications_kind_check');
  } finally {
    await db.query('ROLLBACK');
    await db.query('SET search_path TO public');
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await db.end();
  }
});
