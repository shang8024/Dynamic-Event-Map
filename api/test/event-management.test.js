const test=require('node:test');
const assert=require('node:assert/strict');
const {canManageEvent,validateEvent}=require('../services/eventPermissions');
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
