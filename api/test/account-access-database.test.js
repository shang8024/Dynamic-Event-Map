const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Pool}=require('pg');
const {setAccountStatus}=require('../scripts/set-account-status');
const {accountAccessReason}=require('../services/accountAccess');

test('account disable/enable/revoke survives DB reads without changing identity or role',
  {skip:process.env.ACCOUNT_ACCESS_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const schema=`account_access_test_${process.pid}`;
  const admin=new Pool({max:1}),db=new Pool({max:1,options:`-c search_path=${schema}`});
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    for(const file of (await fs.readdir(path.resolve(__dirname,'../../db/migrations'))).filter(file=>/^\d.*\.sql$/.test(file)).sort()) {
      await db.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations',file),'utf8'));
    }
    const {rows:[profile]}=await db.query("INSERT INTO profiles(username,google_id,role) VALUES('access-test','fixture-uid','member') RETURNING *");
    const auth_time=Math.floor(Date.now()/1000)-60;
    const read=async()=> (await db.query('SELECT * FROM profiles WHERE id=$1',[profile.id])).rows[0];
    assert.equal(accountAccessReason(await read(),{auth_time}),null);
    await setAccountStatus(db,String(profile.id),'disable');
    assert.equal(accountAccessReason(await read(),{auth_time}),'account_disabled');
    await setAccountStatus(db,String(profile.id),'enable');
    const enabled=await read();
    assert.equal(enabled.disabled_at,null);
    assert.equal(accountAccessReason(enabled,{auth_time,iat:Math.ceil(Date.now()/1000)}),'session_revoked');
    assert.equal(accountAccessReason(enabled,{auth_time:Math.ceil(enabled.token_valid_after.getTime()/1000)}),null);
    await setAccountStatus(db,String(profile.id),'revoke');
    const revoked=await read();
    assert.equal(revoked.disabled_at,null);
    assert.equal(accountAccessReason(revoked,{auth_time}),'session_revoked');
    assert.equal(revoked.google_id,profile.google_id);
    assert.equal(revoked.role,'member');
    const {rows:[system]}=await db.query("INSERT INTO profiles(username) VALUES('system-only') RETURNING id");
    await assert.rejects(setAccountStatus(db,String(system.id),'disable'),/No Firebase-linked profile/);
  } finally {
    await db.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
