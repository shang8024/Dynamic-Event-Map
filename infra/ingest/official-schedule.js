import {Temporal} from '@js-temporal/polyfill';
const ZONE='America/Toronto';
function clock(value) {
  const match=/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(String(value||'').trim());
  if(!match || +match[1]<1 || +match[1]>12 || +match[2]>59) return null;
  return `${String(+match[1]%12+(match[3].toUpperCase()==='PM'?12:0)).padStart(2,'0')}:${match[2]}`;
}
function localInstant(date,time) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date||'') || !time) return null;
  try {return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(ZONE,{disambiguation:'reject'}).toInstant().toString({smallestUnit:'millisecond'});}
  catch {return null;}
}
function local(value) {return Temporal.Instant.from(value).toZonedDateTimeISO(ZONE);}
const compact=spec=>Object.fromEntries(['startdate','enddate','starttime','endtime','event_frequency','repeat_enddate','midnight_chk','repeat_weekdays','multiple_dates','dates'].map(key=>[key,spec[key]]));
export function projectSchedule(raw) {
  const rules=[],issues=[];
  for(const place of Array.isArray(raw.event_locations)?raw.event_locations:[]) {
    let dates=place.location_dates;
    if(typeof dates==='string') {
      if(Buffer.byteLength(dates)>256*1024) throw new Error('Official schedule exceeds size limit');
      try {dates=JSON.parse(dates);} catch {issues.push('invalid_schedule_json');continue;}
    }
    if(dates!=null && !Array.isArray(dates)) issues.push('invalid_schedule_schema');
    if(!Array.isArray(dates)) continue;
    for(const spec of dates) {
      if(!spec || typeof spec!=='object') continue;
      if(!['Single Date','Multiple','Daily','Weekly'].includes(spec.event_frequency)) issues.push('unsupported_frequency');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(spec.startdate||'')) issues.push('invalid_start_date');
      if(rules.length>=1000 || (spec.multiple_dates?.length||0)>1000 || (spec.dates?.length||0)>2000) throw new Error('Official schedule exceeds occurrence limit');
      rules.push(compact(spec));
    }
  }
  const starts=(Array.isArray(raw.event_dates)?raw.event_dates:[]).map(item=>item.date).filter(Number.isSafeInteger);
  if(starts.length>2000) throw new Error('Official schedule exceeds occurrence limit');
  return {rules,starts,issues:[...new Set(issues)]};
}
function explicit(spec) {
  return [{sdate:spec.startdate,edate:spec.enddate,stime:spec.starttime,etime:spec.endtime},
    ...(spec.event_frequency==='Multiple' && Array.isArray(spec.multiple_dates)?spec.multiple_dates.filter(item=>item && typeof item==='object'):[])];
}
export function officialOccurrences(schedule, observed=[]) {
  const starts=new Map(observed.map(item=>[item.starts_at,{...item,ends_at:null}]));
  for(const epoch of [...schedule.starts,...schedule.rules.flatMap(rule=>Array.isArray(rule.dates)?rule.dates:[])]) {
    if(!Number.isSafeInteger(epoch)) continue;
    const value=new Date(epoch);if(!Number.isFinite(+value)) continue;
    const start=value.toISOString();if(!starts.has(start)) starts.set(start,{starts_at:start,ends_at:null});
  }
  for(const rule of schedule.rules) for(const range of explicit(rule)) {
    const start=localInstant(range.sdate,clock(range.stime));
    if(start && !starts.has(start)) starts.set(start,{starts_at:start,ends_at:null});
  }
  if(starts.size>2000) throw new Error('Official schedule exceeds occurrence limit');
  return [...starts.values()].map(item=>{
    const point=local(item.starts_at),day=point.toPlainDate().toString(),time=point.toPlainTime().toString({smallestUnit:'minute'});
    const ends=new Set();
    for(const rule of schedule.rules) {
      for(const range of explicit(rule)) {
        if(range.sdate===day && clock(range.stime)===time) {
          const end=localInstant(range.edate,clock(range.etime));if(end && end>=item.starts_at) ends.add(end);
        }
      }
      if(!['Daily','Weekly'].includes(rule.event_frequency) || day<rule.startdate || !rule.repeat_enddate || day>rule.repeat_enddate) continue;
      const weekday=rule.event_frequency==='Weekly'?rule.repeat_weekdays?.[point.dayOfWeek%7]:null;
      if(rule.event_frequency==='Weekly' && weekday?.checked!==true) continue;
      if(clock(weekday?.stime||rule.starttime)!==time) continue;
      let days;
      try {days=Temporal.PlainDate.from(rule.startdate).until(Temporal.PlainDate.from(rule.enddate)).days;} catch {continue;}
      if(days<0 || days>31) continue;
      const endDay=point.toPlainDate().add({days}).toString();
      const end=localInstant(endDay,clock(weekday?weekday.etime:rule.endtime));
      if(end && end>=item.starts_at) ends.add(end);
    }
    // Conflicting venue schedules or ambiguous DST ends stay unknown.
    return {...item,ends_at:ends.size===1?[...ends][0]:null,...(ends.size>1?{schedule_issue:'conflicting_ends'}:{})};
  }).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
}
