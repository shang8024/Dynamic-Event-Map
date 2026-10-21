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

test('legacy data-only schedules remain visible and empty hydrated schedules take precedence',()=>{
  const slot={key:'legacy',starts_at:'2027-01-01T14:00:00Z',ends_at:null};
  assert.deepEqual(publicEvent({data:{occurrences:[slot]}}).occurrences,[slot]);
  assert.deepEqual(publicEvent({occurrences:[],data:{occurrences:[slot]}}).occurrences,[]);
  assert.deepEqual(publicEvent({id:1,data:null}),{id:1,data:{}});
});
