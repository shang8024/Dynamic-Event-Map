import test from 'node:test';
import assert from 'node:assert/strict';
import {eventOccurrences,nextStart,nextOccurrence,isEnded,occurrenceTime,scheduleSummary} from '../src/utils/event.js';
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

test('detail labels distinguish an ongoing slot, a gap and an unconfirmed next date',()=>{
  assert.equal(scheduleSummary(event,Date.parse('2026-11-01T06:00:00Z')).label,'Happening now');
  assert.equal(scheduleSummary(event,Date.parse('2026-11-02T00:00:00Z')).label,'Next occurrence');
  const unknown=scheduleSummary(event,Date.parse('2026-11-06T00:00:00Z'));
  assert.equal(unknown.label,'Dates to be confirmed');
  assert.doesNotMatch(unknown.text,/Nov 1/);
});

test('saved legacy comment rows retain their date display without claiming unknown ends are ongoing',()=>{
  const legacy={startsAt:'2026-11-01T15:00:00Z',endsAt:'2026-11-01T17:00:00Z'};
  assert.equal(scheduleSummary(legacy,Date.parse('2026-11-01T16:00:00Z')).label,'Happening now');
  assert.match(scheduleSummary(legacy,Date.parse('2026-11-02T00:00:00Z')).text,/Nov 1/);
  assert.equal(scheduleSummary({...legacy,endsAt:null},Date.parse('2026-11-02T00:00:00Z')).label,'Dates to be confirmed');
});
