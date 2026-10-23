const test=require('node:test'),assert=require('node:assert/strict');
const {publicEvent}=require('../services/publicEvents');

test('public event data retains display and schedule fields without internal import snapshots',()=>{
  const ranges=Array.from({length:50},(_,i)=>({key:`slot-${i}`,starts_at:`2027-01-${String(i%28+1).padStart(2,'0')}T14:00:00Z`,ends_at:null,source_row_id:'internal'}));
  const row={id:12,user_id:7,title:'<svg onload=alert(1)>',source:'external',version:3,archived_at:null,
    ref_id:'internal-source-id',data:{image:{url:'https://images.unsplash.com/example',alt:'<img>',credit:'Credit'},
      imported_image:{url:'https://secure.toronto.ca/photo'},website:'https://example.test',place_id:'venue',
      image_hidden:false,editor_overrides:['title'],schedule_format:2,schedule_origin:'official',
      occurrences:ranges,import_snapshot:{private:'raw'},import_metadata:{diagnostic:'raw'}},occurrences:ranges,
    next_occurrence:{starts_at:ranges[0].starts_at,ends_at:null,event_id:12,source_key:'internal',created_at:'internal'}};
  const result=publicEvent(row);
  assert.equal(result.title,row.title);
  assert.deepEqual(result.data.image,row.data.image);
  assert.equal(result.data.website,row.data.website);
  assert.equal(result.data.schedule_format,2);
  assert.equal(result.occurrences.length,50);
  assert.equal(result.occurrences[0].ends_at,null);
  assert.deepEqual(result.next_occurrence,{starts_at:ranges[0].starts_at,ends_at:null});
  assert.ok(!Object.hasOwn(result,'ref_id'));
  assert.ok(!Object.hasOwn(result.data,'import_snapshot'));
  assert.ok(!Object.hasOwn(result.data,'import_metadata'));
  assert.ok(!Object.hasOwn(result.data,'occurrences'));
  assert.ok(!Object.hasOwn(result.occurrences[0],'source_row_id'));
  assert.equal(row.data.occurrences,ranges);
});

test('private publisher declarations are kept out of public event data',()=>{
  const row={id:1,data:{submission:{role:'organizer',organizer_confirmed_at:'2026-10-22T12:00:00Z'}}};
  assert.deepEqual(publicEvent(row),{id:1,data:{}});
});

test('community attribution exposes only the declared role, count and three public names',()=>{
  const result=publicEvent({source:'internal',contributor_count:4,contributor_preview:Array.from({length:4},(_,i)=>({id:i+1,name:`Reporter ${i+1}`,email:'private@example.test'})),
    data:{submission:{role:'reporter',organizer_confirmed_at:'private'},organizer_name:'Community Centre'}});
  assert.equal(result.submission_role,'reporter');assert.equal(result.contributor_count,4);assert.equal(result.contributor_preview.length,3);
  assert.ok(result.contributor_preview.every(person=>!Object.hasOwn(person,'email')));
  assert.equal(result.data.organizer_name,'Community Centre');assert.ok(!Object.hasOwn(result.data,'submission'));
});

test('legacy data-only schedules remain visible and empty hydrated schedules take precedence',()=>{
  const slot={key:'legacy',starts_at:'2027-01-01T14:00:00Z',ends_at:null};
  assert.deepEqual(publicEvent({data:{occurrences:[slot]}}).occurrences,[slot]);
  assert.deepEqual(publicEvent({occurrences:[],data:{occurrences:[slot]}}).occurrences,[]);
  assert.deepEqual(publicEvent({id:1,data:null}),{id:1,data:{}});
});
