const test=require('node:test'),assert=require('node:assert/strict');
const {createEventDuplicates,prepareDraft,THRESHOLD,LIMIT,WEIGHTS}=require('../services/eventDuplicates');

const draft={title:'  Jazz in the Park ',latitude:'43.6534',longitude:-79.3841,
  occurrences:[{starts_at:'2027-06-01T22:00:00Z',ends_at:'2027-06-02T00:00:00Z'},{starts_at:'2027-06-08T22:00:00Z',ends_at:null}]};

test('duplicate checks normalise the draft and treat an open-ended range as a single instant',()=>{
  assert.deepEqual(prepareDraft(draft),{title:'Jazz in the Park',latitude:43.6534,longitude:-79.3841,windows:[
    {starts_at:'2027-06-01T22:00:00.000Z',ends_at:'2027-06-02T00:00:00.000Z'},
    {starts_at:'2027-06-08T22:00:00.000Z',ends_at:'2027-06-08T22:00:00.000Z'}]});
  assert.deepEqual(prepareDraft({title:'Jazz',latitude:0,longitude:0,starts_at:'2027-06-01T22:00:00Z'}).windows,
    [{starts_at:'2027-06-01T22:00:00.000Z',ends_at:'2027-06-01T22:00:00.000Z'}]);
});

test('duplicate checks reject incomplete or malformed drafts with a client error',()=>{
  const rejects=(body,pattern)=>assert.throws(()=>prepareDraft(body),error=>error.status===400 && pattern.test(error.message));
  rejects(null,/Describe the event/);
  rejects({...draft,title:'Hi'},/3 to 255/);
  rejects({...draft,latitude:''},/location/);
  rejects({...draft,longitude:181},/location/);
  rejects({...draft,occurrences:[{starts_at:'tomorrow'}]},/start time/);
  rejects({...draft,occurrences:[{starts_at:'2027-06-02T00:00:00Z',ends_at:'2027-06-01T00:00:00Z'}]},/end after/);
  rejects({...draft,occurrences:Array.from({length:21},()=>draft.occurrences[0])},/at most 20/);
});

test('the scoring query receives the draft, threshold and limit, and rows become scored matches',async()=>{
  const calls=[];
  const pool={query:async(sql,parameters)=>{calls.push({sql,parameters});return {rows:[{id:7,title:'Jazz in the Park',source:'external',category:'Music',
    location_name:null,location_address:'100 Queen St W',starts_at:new Date('2027-06-01T22:00:00Z'),ends_at:null,score:0.93,title_score:1,time_score:1,place_score:0.65}]};}};
  const items=await createEventDuplicates(pool).find(draft);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].parameters.slice(0,1).concat(calls[0].parameters.slice(2)),['Jazz in the Park',43.6534,-79.3841,THRESHOLD,LIMIT]);
  assert.equal(JSON.parse(calls[0].parameters[1]).length,2);
  assert.match(calls[0].sql,/e\.archived_at IS NULL AND e\.status='scheduled'/);
  assert.deepEqual(items,[{id:7,title:'Jazz in the Park',source:'external',category:'Music',location_name:null,location_address:'100 Queen St W',
    starts_at:new Date('2027-06-01T22:00:00Z'),ends_at:null,score:0.93,signals:{title:1,time:1,place:0.65}}]);
  assert.equal(Math.round((WEIGHTS.title+WEIGHTS.time+WEIGHTS.place)*100),100);
  assert.ok(WEIGHTS.time+WEIGHTS.place<THRESHOLD,'the same time and place alone must not be reported as a duplicate');
});
