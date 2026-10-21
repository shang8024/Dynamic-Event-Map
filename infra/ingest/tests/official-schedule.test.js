import test from 'node:test';
import assert from 'node:assert/strict';
import {projectSchedule,officialOccurrences} from '../official-schedule.js';
const parse=rules=>projectSchedule({event_locations:[{location_dates:JSON.stringify(rules)}]});
test('separate date ranges preserve exact ends, unknown ends and gaps',()=>{
  const slots=officialOccurrences(parse([{event_frequency:'Multiple',startdate:'2026-10-25',starttime:'10:00 AM',enddate:'2026-10-25',endtime:'12:00 PM',
    multiple_dates:[{sdate:'2026-10-29',stime:'07:00 PM',edate:'2026-10-30',etime:'01:00 AM'},
      {sdate:'2026-11-01',stime:'10:00 AM',edate:'',etime:''}]}]));
  assert.deepEqual(slots.map(item=>[item.starts_at,item.ends_at]),[
    ['2026-10-25T14:00:00.000Z','2026-10-25T16:00:00.000Z'],
    ['2026-10-29T23:00:00.000Z','2026-10-30T05:00:00.000Z'],['2026-11-01T15:00:00.000Z',null]]);
});
test('weekday-specific ends follow Toronto DST, using only published occurrence dates',()=>{
  const weekly={event_frequency:'Weekly',startdate:'2026-10-31',starttime:'10:00 AM',enddate:'2026-10-31',endtime:'01:00 PM',repeat_enddate:'2026-11-02',
    repeat_weekdays:[{checked:true,stime:'10:00 AM',etime:'05:00 PM'}, {},{},{},{},{},{checked:true,stime:'10:00 AM',etime:'01:00 PM'}],
    dates:[Date.parse('2026-10-31T14:00:00Z'),Date.parse('2026-11-01T15:00:00Z')]};
  const slots=officialOccurrences(parse([weekly]));
  assert.equal(slots.length,2);assert.equal(slots[0].ends_at,'2026-10-31T17:00:00.000Z');assert.equal(slots[1].ends_at,'2026-11-01T22:00:00.000Z');
});
test('ambiguous DST ends and conflicting venue ends are never guessed',()=>{
  const range={event_frequency:'Single Date',startdate:'2026-11-01',starttime:'12:30 AM',enddate:'2026-11-01',endtime:'01:30 AM'};
  assert.equal(officialOccurrences(parse([range]))[0].ends_at,null);
  const first={...range,startdate:'2026-11-02',enddate:'2026-11-02',endtime:'03:00 AM'};
  assert.equal(officialOccurrences(parse([first,{...first,endtime:'04:00 AM'}]))[0].schedule_issue,'conflicting_ends');
});
