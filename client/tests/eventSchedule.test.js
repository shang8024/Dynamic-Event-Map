import test from 'node:test';
import assert from 'node:assert/strict';
import {eventOccurrences,nextStart,nextOccurrence,isEnded,occurrenceTime} from '../src/utils/event.js';
import {editableOccurrences,serializeOccurrences,sameOccurrences} from '../src/utils/eventSchedule.js';
const event={data:{schedule_format:2,occurrences:[{key:'one',starts_at:'2026-11-01T05:30:00Z',ends_at:'2026-11-01T07:00:00Z'},
  {key:'two',starts_at:'2026-11-05T17:00:00Z',ends_at:null}]}};
test('editing preserves existing DST offsets and unknown ends without flattening separate ranges',()=>{
  const result=serializeOccurrences(editableOccurrences(event));
  assert.equal(result.length,2);assert.equal(result[0].starts_at,'2026-11-01T05:30:00.000Z');assert.equal(result[1].ends_at,null);
  assert.equal(sameOccurrences(result,event.data.occurrences),true);
});
test('ongoing, future and unknown schedules never relabel the first historical start as next',()=>{
  assert.equal(nextOccurrence(event,Date.parse('2026-11-01T06:00:00Z')).key,'one');
  assert.equal(nextStart(event,Date.parse('2026-11-02T00:00:00Z')),'2026-11-05T17:00:00Z');
  assert.equal(nextStart(event,Date.parse('2026-11-06T00:00:00Z')),null);
  assert.equal(isEnded(event,Date.parse('2026-11-06T00:00:00Z')),false);
  assert.match(occurrenceTime(event.data.occurrences[1]),/End time not provided/);
  assert.equal(eventOccurrences(event).length,2);
});
