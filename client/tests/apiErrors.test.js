import test from 'node:test';
import assert from 'node:assert/strict';
import {ApiError,responseError,requestJSON,retryAfterSeconds,clientError} from '../src/services/apiErrors.js';
const response=(status,body,headers={})=>({ok:status<400,status,json:async()=>body,headers:new Headers(headers)});

test('account blocking, unverified email and ordinary permissions have distinct recovery messages',async()=>{
  const cases=[[401,{code:'session_revoked'},'session_revoked',/Sign out and sign in/],
    [403,{code:'account_disabled'},'account_disabled',/unavailable/],
    [403,{message:'A verified email address is required'},'email_not_verified',/Verify your email/],
    [403,{message:'private operator detail'},'forbidden',/permission/],
    [401,{},'sign_in_required',/sign in again/]];
  for(const [status,body,code,message] of cases) {
    const error=await responseError(response(status,body));assert.equal(error.status,status);assert.equal(error.code,code);assert.match(error.message,message);
  }
});
test('safe validation and image codes survive; arbitrary server messages and codes never reach users',async()=>{
  assert.equal((await responseError(response(400,{error:'An occurrence must end after it starts.'}))).message,'An occurrence must end after it starts.');
  assert.equal((await responseError(response(409,{error:'This event changed. Reopen it before saving.'}))).code,'conflict');
  assert.match((await responseError(response(422,{code:'IMAGE_HOST_NOT_ALLOWED',error:'secret decoder detail'}))).message,/host is not supported/);
  for(const status of [400,403,409,422,500,503]) {
    const error=await responseError(response(status,{error:'secret SQL password=private',code:'private_stacktrace'}));
    assert.doesNotMatch(error.message,/SQL|password|private/);assert.notEqual(error.code,'private_stacktrace');
  }
});
test('rate limits retain a bounded Retry-After value and actionable copy',async()=>{
  const error=await responseError(response(429,{message:'Too many requests'},{'Retry-After':'90'}));
  assert.equal(error.retryAfter,90);assert.equal(error.code,'rate_limited');assert.match(error.message,/90 seconds/);
  assert.equal(retryAfterSeconds('Wed, 21 Oct 2026 12:00:30 GMT',Date.parse('2026-10-21T12:00:00Z')),30);
  assert.equal(retryAfterSeconds('99999999999999'),86400);assert.equal(retryAfterSeconds('invalid'),null);assert.equal(retryAfterSeconds('-1'),null);
});
test('transport failures distinguish unconfirmed writes from failed reads without automatic retry',async()=>{
  for(const method of ['GET','POST','PUT','DELETE']) {
    let calls=0;
    await assert.rejects(requestJSON('/private-url',{method},async()=>{calls++;throw new Error('sensitive backend address');}),error=>{
      assert.ok(error instanceof ApiError);assert.equal(error.ambiguous,method!=='GET');assert.equal(error.status,null);
      assert.equal(error.code,'network_error');assert.doesNotMatch(error.message,/sensitive|private-url/);return true;
    });assert.equal(calls,1);
  }
  assert.equal(clientError({code:'auth/user-disabled'}).code,'account_disabled');
  assert.equal(clientError({name:'TimeoutError'},{method:'POST',dispatched:false}).ambiguous,false);
});
test('server errors and unreadable success responses leave write outcome unconfirmed',async()=>{
  await assert.rejects(requestJSON('/api/events',{method:'POST'},async()=>response(503,{message:'private'})),error=>error.ambiguous&&error.status===503);
  await assert.rejects(requestJSON('/api/bookmarks/1',{method:'DELETE'},async()=>({ok:true,status:200,json:async()=>{throw new Error('invalid json');}})),error=>error.ambiguous&&error.code==='response_unconfirmed');
});
