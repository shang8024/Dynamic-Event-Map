import test from 'node:test';
import assert from 'node:assert/strict';
import {eventView,eventImage,representative,nextStart,compareEventStarts} from '../src/utils/event.js';
import {torontoInput,torontoInstant} from '../src/utils/eventDate.js';
import {getEventStatus} from '../src/utils/date.js';
test('missing coordinates stay missing and linked images use only the same-origin proxy',()=>{
  const event=eventView({id:1,latitude:null,longitude:null,data:{imported_image:{url:'https://secure.toronto.ca/image'}}});
  assert.equal(event.position,null);
  assert.match(event.img,/^\/api\/events\/1\/image\?/);
  assert.equal(eventImage({...event,ends_at:'2020-01-01'}),null);
  assert.equal(eventImage({...event,status:'cancelled'}),null);
});
test('cluster representative prefers real images and is stable',()=>{
  const events=[{id:2,starts_at:'2027-01-01'}, {id:1,starts_at:'2027-01-02',data:{imported_image:{url:'https://images.unsplash.com/a'}}}];
  assert.equal(representative(events).id,1);
  assert.equal(representative([...events].reverse()).id,1);
  assert.equal(nextStart({starts_at:'2027-02-01',next_start:'2027-01-01',data:{editor_overrides:['starts_at']}}),'2027-02-01');
});
test('Toronto date editing preserves unchanged DST offsets and rejects ambiguous new times',()=>{
  assert.equal(torontoInput('2026-11-01T05:30:00Z'),'2026-11-01T01:30');
  assert.equal(torontoInstant('2026-11-01T01:30','2026-11-01T05:30:00Z'),'2026-11-01T05:30:00.000Z');
  assert.throws(()=>torontoInstant('2026-11-01T01:30'));
  assert.throws(()=>torontoInstant('2027-03-14T02:30'));
  assert.equal(torontoInstant('2026-12-01T18:00'),'2026-12-01T23:00:00Z');
});
test('saved-event rows show ended/cancelled status without requesting expired photos',()=>{
  const row={id:9,title:'Saved event',ends_at:'2020-01-02',status:'scheduled',data:{image:{url:'https://images.unsplash.com/a'}}};
  assert.equal(getEventStatus({_row:row}),'Expired');assert.equal(eventImage({id:9,_row:row}),null);
  assert.equal(getEventStatus({...row,status:'cancelled'}),'Cancelled');
});
test('unknown dates sort last and text changes retain the photo cache key',()=>{
  const photo={id:3,starts_at:'2027-01-01',version:1,data:{image:{url:'https://images.unsplash.com/a'}}};
  const unknown={id:1,occurrences:[{starts_at:'2020-01-01',ends_at:null}],data:{schedule_format:2}};
  assert.deepEqual([unknown,photo].sort(compareEventStarts).map(e=>e.id),[3,1]);
  assert.equal(eventImage(photo).url,eventImage({...photo,title:'Revised',version:2}).url);
  assert.notEqual(eventImage(photo).url,eventImage({...photo,data:{image:{url:'https://images.unsplash.com/b'}}}).url);
});
