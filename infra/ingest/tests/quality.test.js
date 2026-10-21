import test from 'node:test';
import assert from 'node:assert/strict';
import {assessQuality} from '../quality.js';
import {verifyImportedRows,lostSourceFields} from '../verify-import.js';
const events=(bad,total)=>Array.from({length:total},(_,index)=>({ref_id:`event:${index}`,issue:index<bad}));
test('alerts use both a minimum count and a ratio; legitimate unknown ends are not errors',()=>{
  assert.equal(assessQuality(events(1,2),new Set()).blocked,false);
  assert.equal(assessQuality(events(3,30),new Set()).blocked,true);
  assert.equal(assessQuality(events(3,31),new Set()).blocked,false);
  assert.equal(assessQuality(events(3,30),new Set(events(3,30).map(item=>item.ref_id))).blocked,true);
  assert.equal(assessQuality(events(0,30),new Set()).blocked,false);
});
test('post-write validation detects missing database content and preserves explicit manual overrides',()=>{
  const event={ref_id:'event:1',title:'Title',description:'Description',starts_at:'2026-11-01T15:00:00.123Z',
    ends_at:null,data:{import_snapshot:{content_hash:'verified'},occurrences:[{starts_at:'2026-11-01T15:00:00Z',ends_at:null}],
      imported_image:{url:'https://images.unsplash.com/example',credit:'Photographer'},website:'https://example.test'}};
  const row={...event,user_id:7,starts_at:new Date(event.starts_at),data:{...event.data,imported_image:{credit:'Photographer',url:'https://images.unsplash.com/example'}}};
  assert.doesNotThrow(()=>verifyImportedRows({events:[event]},[],[row]));
  for(const field of ['title','description','starts_at']) {
    assert.throws(()=>verifyImportedRows({events:[event]},[],[{...row,[field]:null}]),error=>error.code==='INGEST_INTEGRITY');
  }
  assert.throws(()=>verifyImportedRows({events:[event]},[],[{...row,data:{...row.data,occurrences:[]}}]),/fields differ/);
  const before={...row,title:'Admin title',data:{...row.data,editor_overrides:['title'],import_snapshot:{...event,content_hash:'previous'}}};
  assert.doesNotThrow(()=>verifyImportedRows({events:[event]},[before],[{...row,title:'Admin title'}]));
  assert.ok(lostSourceFields({...before,description:null},{...event,description:null}).includes('existing:description'));
});
