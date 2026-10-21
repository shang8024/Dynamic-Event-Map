import test from 'node:test';
import assert from 'node:assert/strict';
import {setImmediate} from 'node:timers';
import {createNotificationInbox,readNotificationRange} from '../src/services/notificationInbox.js';

const rows=(from,to,read=null)=>Array.from({length:from-to+1},(_,index)=>({id:String(from-index),read_at:read,title:`Notification ${from-index}`}));
function source(items,unread=items.length) {
  return async before=>{
    const page=items.filter(item=>before==null||BigInt(item.id)<BigInt(before)).slice(0,30);
    return {items:page,unread,next:page.length===30?page.at(-1).id:null};
  };
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('refresh walks every intervening page after a burst and preserves loaded history',async()=>{
  const calls=[],fetchPage=source(rows(150,1));
  const result=await readNotificationRange(async before=>{calls.push(before);return fetchPage(before);},'11');
  assert.deepEqual(result.items.map(item=>item.id),rows(150,1).map(item=>item.id));
  assert.deepEqual(calls,[null,'121','91','61','31']);
  assert.equal(result.next,'1');
});

test('a pathological advancing cursor has a finite page budget and an actionable recovery',async()=>{
  let calls=0;
  await assert.rejects(readNotificationRange(async()=>{
    calls++;return {items:[{id:String(100+calls)}],unread:1,next:String(100+calls)};
  },'1',undefined,{maxPages:3}),/Reload this page/);
  assert.equal(calls,3);
});

test('the whole refresh has a deadline even if a stalled transport ignores cancellation',async()=>{
  await assert.rejects(readNotificationRange(()=>new Promise(()=>{}),'1',undefined,{timeoutMs:5}),/took too long/);
});

test('a failed refresh or more request keeps the prior data and retry cursor',async()=>{
  let fail=false;
  const inbox=createNotificationInbox({get:async url=>{if(fail) throw new Error('Please wait before retrying.');return source(rows(65,1))(new URL(url,'http://localhost').searchParams.get('before'));},post:async()=>({})});
  inbox.start();await inbox.refresh();await inbox.more();
  const before=inbox.getSnapshot().data;
  fail=true;await inbox.refresh();await inbox.more();
  assert.deepEqual(inbox.getSnapshot().data,before);
  assert.match(inbox.getSnapshot().error,/wait/);
  assert.match(inbox.getSnapshot().moreError,/wait/);
  assert.equal(inbox.getSnapshot().loadingMore,false);
  inbox.stop();
});

test('mark read does not collapse loaded pages and a concurrent stale refresh cannot undo it',async()=>{
  let items=rows(65,1),release,delay=false;
  const inbox=createNotificationInbox({get:async url=>{
    const snapshot=await source(items,items.filter(item=>!item.read_at).length)(new URL(url,'http://localhost').searchParams.get('before'));
    if(delay) {delay=false;await new Promise(resolve=>{release=resolve;});}
    return snapshot;
  },post:async(_url,{id})=>{items=items.map(item=>String(item.id)===String(id)?{...item,read_at:'read'}:item);}});
  inbox.start();await inbox.refresh();await inbox.more();
  delay=true;const refresh=inbox.refresh();await tick();
  await inbox.mark('45');release();await refresh;
  const result=inbox.getSnapshot();
  assert.equal(result.data.items.length,60);
  assert.equal(result.data.items.find(item=>item.id==='45').read_at,'read');
  assert.equal(result.data.next,'6');
  assert.deepEqual(result.marking,[]);
  inbox.stop();
});

test('read operations serialize and logout prevents late responses from replacing another account',async()=>{
  let release;
  const inbox=createNotificationInbox({get:async()=>new Promise(resolve=>{release=resolve;}),post:async()=>({})});
  inbox.start();const request=inbox.refresh();await tick();inbox.stop();
  release({items:rows(5,1),unread:5,next:null});await request;
  assert.deepEqual(inbox.getSnapshot().data.items,[]);
});

test('repeated load-more clicks share one request and append unique rows',async()=>{
  let count=0,release;
  const inbox=createNotificationInbox({get:async url=>{
    count++;
    if(url.includes('before=')) await new Promise(resolve=>{release=resolve;});
    return source(rows(65,1))(new URL(url,'http://localhost').searchParams.get('before'));
  },post:async()=>({})});
  inbox.start();await inbox.refresh();
  const first=inbox.more(),second=inbox.more();await tick();
  assert.equal(first,second);assert.equal(count,2);release();await first;
  assert.equal(inbox.getSnapshot().data.items.length,60);
  assert.equal(new Set(inbox.getSnapshot().data.items.map(item=>item.id)).size,60);
  inbox.stop();
});

test('an update received during a refresh schedules a fresh read instead of losing the event',async()=>{
  let items=rows(30,1),release,delay=false;
  const inbox=createNotificationInbox({get:async url=>{
    const result=await source(items)(new URL(url,'http://localhost').searchParams.get('before'));
    if(delay) {delay=false;await new Promise(resolve=>{release=resolve;});}
    return result;
  },post:async()=>({})});
  inbox.start();await inbox.refresh();
  delay=true;const pending=inbox.refresh();await tick();
  items=rows(35,1);void inbox.invalidate();release();await pending;
  assert.equal(inbox.getSnapshot().data.items[0].id,'35');
  assert.equal(inbox.getSnapshot().data.items.length,35);
  inbox.stop();
});
