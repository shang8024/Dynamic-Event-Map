const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {spawnSync} = require('node:child_process');
const {accountAccessReason} = require('../services/accountAccess');
const {setAccountStatus,validateArguments} = require('../scripts/set-account-status');

test('existing accounts without access-control fields remain compatible', () => {
  assert.equal(accountAccessReason({id:7},{}),null);
  assert.equal(accountAccessReason({id:7,disabled_at:null,token_valid_after:null},{}),null);
  assert.equal(accountAccessReason(null,{}),'account_unavailable');
});

test('a locally disabled account is blocked regardless of token freshness', () => {
  assert.equal(accountAccessReason({disabled_at:new Date(),token_valid_after:null},{auth_time:2**31}),'account_disabled');
});

test('revocation requires a fresh authentication, never just a refreshed ID token', () => {
  const cutoff='2026-10-21T14:00:00.100Z';
  const seconds=Math.floor(Date.parse(cutoff)/1000);
  const profile={disabled_at:null,token_valid_after:cutoff};
  assert.equal(accountAccessReason(profile,{auth_time:seconds-60,iat:seconds+3600}),'session_revoked');
  assert.equal(accountAccessReason(profile,{auth_time:seconds}),'session_revoked');
  assert.equal(accountAccessReason(profile,{auth_time:seconds+1}),null);
  for (const auth_time of [undefined,null,String(seconds+1),NaN,seconds+0.5]) {
    assert.equal(accountAccessReason(profile,{auth_time}),'session_revoked');
  }
  assert.equal(accountAccessReason({token_valid_after:'invalid'},{auth_time:seconds+1}),'account_unavailable');
});

test('the operator accepts only a real profile ID and bounded actions', async () => {
  for (const [id,action] of [['0','disable'],['-1','disable'],['7 OR 1=1','enable'],['2147483648','revoke'],['7','admin'],['7','delete']]) {
    assert.throws(()=>validateArguments(id,action),/Usage:/);
    await assert.rejects(setAccountStatus({query(){assert.fail('invalid input reached SQL');}},id,action),/Usage:/);
  }
  for (const action of ['disable','enable','revoke']) assert.doesNotThrow(()=>validateArguments('2147483647',action));
});

test('disable, enable and revoke all advance the session cutoff without granting privileges', async () => {
  for (const [action,disabled] of [['disable','COALESCE(disabled_at,now())'],['enable','NULL'],['revoke','disabled_at']]) {
    let queried=false;
    const result=await setAccountStatus({async query(sql,values){
      queried=true;
      assert.match(sql,/token_valid_after=GREATEST\(COALESCE\(token_valid_after,'-infinity'::timestamptz\),now\(\)\)/);
      assert.ok(sql.includes(`disabled_at=${disabled},`));
      assert.match(sql,/WHERE id=\$1 AND google_id IS NOT NULL/);
      assert.doesNotMatch(sql,/SET[^]*\brole\s*=/);
      assert.deepEqual(values,['7']);
      return {rows:[{id:7,disabled_at:null,token_valid_after:new Date()}]};
    }},'7',action);
    assert.equal(queried,true);
    assert.deepEqual(result,{id:7,action});
  }
  await assert.rejects(setAccountStatus({async query(){return {rows:[]};}},'7','disable'),/No Firebase-linked profile/);
});

test('invalid operator CLI arguments fail before opening a DB connection and do not echo input', () => {
  const probe='private-value-must-not-print';
  const result=spawnSync(process.execPath,[path.resolve(__dirname,'../scripts/set-account-status.js'),probe,'disable'],{encoding:'utf8'});
  assert.equal(result.status,1);
  assert.match(result.stderr,/Usage:/);
  assert.doesNotMatch(result.stderr,new RegExp(probe));
  assert.equal(result.stdout,'');
});

function runFirebaseConfig(env) {
  const filename=path.resolve(__dirname,'../config/firebaseAdmin.js');
  const initialized=[];
  const admin={initializeApp(options){initialized.push(options);}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
    process:{env},module:{exports:{}},console:{log(){},warn(){},error(){}},
    require(name){
      if(name==='firebase-admin') return admin;
      if(name==='fs') return {};
      assert.fail(`unexpected config dependency ${name}`);
    },
  },{filename});
  return initialized;
}

test('production cannot start in the unsigned Firebase emulator verification mode', () => {
  assert.throws(()=>runFirebaseConfig({NODE_ENV:'production',FIREBASE_AUTH_EMULATOR_HOST:'localhost:9099'}),/must not be enabled in production/);
  assert.deepEqual(JSON.parse(JSON.stringify(runFirebaseConfig({NODE_ENV:'production',FIREBASE_PROJECT_ID:'eventmap-test'}))),[{projectId:'eventmap-test'}]);
  assert.equal(runFirebaseConfig({NODE_ENV:'development',FIREBASE_AUTH_EMULATOR_HOST:'localhost:9099',FIREBASE_PROJECT_ID:'eventmap-test'}).length,1);
});
