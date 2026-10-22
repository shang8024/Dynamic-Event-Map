import test from 'node:test';
import assert from 'node:assert/strict';
import {eventDraftSignature,eventLocationError,locationPoint,sameLocation,withinGTA} from '../src/utils/eventLocation.js';

const venue={location_address:'100 Queen St W, Toronto',latitude:43.6534,longitude:-79.3841,place_id:'toronto-city-hall'};

test('new locations require a selected venue or explicit manual pin confirmation',()=>{
  assert.equal(eventLocationError(venue),'');
  const manual={...venue,place_id:null};
  assert.match(eventLocationError(manual),/Confirm that this pin/);
  assert.equal(eventLocationError(manual,{confirmed:true}),'');
});

test('confirmation cannot approve missing, invalid or outside-GTA coordinates',()=>{
  for(const latitude of ['',null,undefined,NaN,91]) {
    assert.equal(locationPoint({...venue,latitude}),null);
    assert.match(eventLocationError({...venue,latitude},{confirmed:true}),/valid pin coordinates/);
  }
  assert.equal(withinGTA({lat:45.4215,lng:-75.6972}),false);
  assert.match(eventLocationError({...venue,latitude:45.4215,longitude:-75.6972},{confirmed:true}),/Greater Toronto Area/);
});

test('unrelated edits keep incomplete imported locations editable without fabricating a pin',()=>{
  const imported={location_address:'Location to be confirmed',latitude:null,longitude:null};
  assert.equal(eventLocationError({...imported,title:'Updated title'},{existing:imported}),'');
  assert.match(eventLocationError({...imported,location_address:'A new address'},{existing:imported}),/valid pin coordinates/);
});

test('changing an existing address or pin requires renewed location confirmation',()=>{
  const edited={...venue,location_address:'Different venue',place_id:null};
  assert.match(eventLocationError(edited,{existing:venue}),/Confirm that this pin/);
  assert.equal(eventLocationError(edited,{existing:venue,confirmed:true}),'');
  assert.equal(sameLocation({...venue,latitude:String(venue.latitude)},venue),true);
  assert.equal(sameLocation({...venue,longitude:-79.4},venue),false);
});

test('choosing a publishing connection or confirming an organizer marks the draft as unsaved',()=>{
  const draft={...venue,submission_role:'',organizer_confirmed:false};
  const selected={...draft,submission_role:'organizer'};
  assert.notEqual(eventDraftSignature(draft,[]),eventDraftSignature(selected,[]));
  assert.notEqual(eventDraftSignature(selected,[]),eventDraftSignature({...selected,organizer_confirmed:true},[]));
});
