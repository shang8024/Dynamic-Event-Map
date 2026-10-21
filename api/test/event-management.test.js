const test=require('node:test');
const assert=require('node:assert/strict');
const {canManageEvent,validateEvent}=require('../services/eventPermissions');
const {normalizeOccurrences,prepareEventInput}=require('../services/eventSchedule');
test('event administration is a server role and never inferred from email or source',()=>{
  const official={user_id:1,source:'external'};
  assert.equal(canManageEvent({id:2,role:'member',email:'admin@example.test'},official),false);
  assert.equal(canManageEvent({id:2,role:'admin'},official),true);
  assert.equal(canManageEvent({id:1,role:'member'},official),true);
  assert.equal(canManageEvent(null,official),false);
});
test('event dates require explicit timezone, valid order and real coordinates',()=>{
  const event={title:'Test',description:'An event',location_address:'GTA',latitude:43.7,longitude:-79.4,starts_at:'2026-11-01T01:30:00-04:00',ends_at:'2026-11-01T01:30:00-05:00'};
  assert.equal(validateEvent(event),null);
  assert.match(validateEvent({...event,starts_at:'2026-11-01T01:30'}),/timezone/);
  assert.match(validateEvent({...event,ends_at:'2026-10-31T01:00:00Z'}),/after/);
  assert.match(validateEvent({...event,latitude:null}),/location/);
  assert.match(validateEvent({...event,status:'forged'}),/status/);
});

test('occurrence validation rejects impossible calendar days and retains explicit DST offsets',()=>{
  for(const starts_at of ['2026-02-30T10:00:00Z','2026-11-01T01:30:00']) {
    assert.throws(()=>normalizeOccurrences([{starts_at}]),/valid timezone/);
  }
  const input={occurrences:[{key:'fall-back',starts_at:'2026-11-01T01:30:00-04:00',ends_at:'2026-11-01T01:30:00-05:00'},
    {key:'unknown-end',starts_at:'2026-11-02T10:00:00-05:00'}]};
  const normalized=prepareEventInput(input);
  assert.equal(normalized.occurrences[0].starts_at,'2026-11-01T05:30:00.000Z');
  assert.equal(normalized.occurrences[0].ends_at,'2026-11-01T06:30:00.000Z');
  assert.equal(normalized.ends_at,null);
  assert.throws(()=>normalizeOccurrences([input.occurrences[0],{...input.occurrences[0],key:'duplicate'}]),/duplicate event/);
});
