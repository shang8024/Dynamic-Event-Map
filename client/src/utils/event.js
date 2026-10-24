export const GTA_BOUNDS={north:44.55,south:43.3,west:-80.2,east:-78.3};
export const CATEGORIES=['Arts & Culture','Entertainment & Leisure','Education & Workshops','Sports & Fitness','Food & Drink','Business & Networking','Community & Social','Family & Kids','Technology & Innovation','Other'];
export function eventImage(event, size="detail") {
  const data=event?.data||event?._row?.data||{};
  if(isEnded(event) || event?.status==='cancelled' || event?._row?.status==='cancelled' || data.image_hidden) return null;
  const source=data.image||data.imported_image;
  if(!source?.url || !event?.id) return null;
  const tag=Array.from(source.url).reduce((hash,ch)=>Math.imul(hash^ch.charCodeAt(0),16777619)>>>0,2166136261);
  return {...source,url:`/api/events/${event.id}/image?size=${size==='thumb'?'thumb':'detail'}&v=${encodeURIComponent(`${tag}-${source.revision||1}`)}`};
}
export function isEnded(event,now=Date.now()) {
  if(event?.archived_at || event?._row?.archived_at) return true;
  const slots=eventOccurrences(event);
  if(slots.some(item=>new Date(item.starts_at).getTime()>=now || item.ends_at && new Date(item.ends_at).getTime()>now)) return false;
  if(slots.length && slots.every(item=>item.ends_at && new Date(item.ends_at).getTime()<=now)) return true;
  const end=event?.ends_at||event?.endsAt||event?._row?.ends_at;
  return Boolean(end && new Date(end).getTime()<now);
}
export function eventView(row) {
  const latitude=row.latitude,longitude=row.longitude;
  const valid=latitude!=null && longitude!=null && latitude!=='' && longitude!=='' && Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude)) && Math.abs(Number(latitude))<=90 && Math.abs(Number(longitude))<=180;
  const value={...row,position:valid?{lat:Number(latitude),lng:Number(longitude)}:null,num_bookmarks:Number(row.bookmarks_count||0)};
  return {...value,img:eventImage(value)?.url||null};
}
export function nextStart(event,now=Date.now()) {
  const slot=nextOccurrence(event,now);if(slot) return slot.starts_at;
  if(event?._summary) return null;
  if(event?.data?.schedule_format===2 || event?.occurrences?.length>0) return null;
  if(event?.data?.editor_overrides?.includes('starts_at')) return event.starts_at;
  if(event?.next_start && new Date(event.next_start).getTime()>=now) return event.next_start;
  return event?.data?.occurrences?.map(item=>item.starts_at).filter(value=>new Date(value).getTime()>=now).sort()[0]||event?.starts_at||event?.startsAt||event?._row?.starts_at;
}
const occurrenceCache=new WeakMap();
export function eventOccurrences(event) {
  const row=event?._row||event||{};
  const values=row.occurrences ?? row.data?.occurrences;
  if(!Array.isArray(values)) return [];
  if(!occurrenceCache.has(values)) occurrenceCache.set(values,Object.freeze(values.filter(item=>item.starts_at && Number.isFinite(Date.parse(item.starts_at))).sort((a,b)=>Date.parse(a.starts_at)-Date.parse(b.starts_at))));
  return occurrenceCache.get(values);
}
export function nextOccurrence(event,now=Date.now()) {
  if(event?._summary) {
    const item=event.next_occurrence;
    return item&&(Date.parse(item.starts_at)>=now||item.ends_at&&Date.parse(item.ends_at)>now)?item:null;
  }
  const slots=eventOccurrences(event);
  return slots.find(item=>Date.parse(item.starts_at)<=now && item.ends_at && Date.parse(item.ends_at)>now)
    ||slots.find(item=>Date.parse(item.starts_at)>=now)||null;
}
export function occurrenceTime(item) {
  return [item?.starts_at,item?.ends_at].filter(value=>value&&Number.isFinite(new Date(value).getTime())).map(eventTime).join(' — ')||'--';
}
export function scheduleSummary(event,now=Date.now()) {
  const recordedStart=event?.starts_at||event?.startsAt||event?._row?.starts_at;
  if(isEnded(event,now)) {
    const start=recordedStart;
    const end=event?.ends_at||event?.endsAt||event?._row?.ends_at||eventOccurrences(event).at(-1)?.ends_at;
    return {label:'Event dates',text:start?`Started ${eventTime(start)}${end?` · Last ended ${eventTime(end)}`:''}`:eventTime(end)};
  }
  const slot=nextOccurrence(event,now);
  if(slot) return {label:Date.parse(slot.starts_at)<=now?'Happening now':'Next occurrence',text:occurrenceTime(slot)};
  const start=nextStart(event,now);
  const end=event?.ends_at||event?.endsAt||event?._row?.ends_at;
  if(!eventOccurrences(event).length&&start&&end&&Date.parse(start)<=now&&Date.parse(end)>now) return {label:'Happening now',text:occurrenceTime({starts_at:start,ends_at:end})};
  if(start && Date.parse(start)>=now) return {label:'Next occurrence',text:eventTime(start)};
  return {label:'Dates to be confirmed',text:recordedStart||end||eventOccurrences(event).length?'Check the organizer’s schedule for the next date.':'--'};
}
const timeFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',dateStyle:'medium',timeStyle:'short'});
export function eventTime(value) {
  if(!value || !Number.isFinite(new Date(value).getTime())) return '--';
  return timeFormatter.format(new Date(value));
}
export function distanceKm(a,b) {
  if(!a||!b) return Infinity;const rad=value=>value*Math.PI/180;
  const x=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
export function representative(events) {
  let best,bestPhoto=false;
  for(const event of events) {
    const photo=Boolean(eventImage(event,'thumb'));
    if(!best || photo&&!bestPhoto || photo===bestPhoto&&compareEventStarts(event,best)<0) {best=event;bestPhoto=photo;}
  }
  return best;
}
export function compareEventStarts(a,b) {
  const timestamp=event=>{const value=nextStart(event);return value&&Number.isFinite(Date.parse(value))?Date.parse(value):Infinity;};
  const left=timestamp(a),right=timestamp(b);
  return (left===right?0:left-right)||Number(a.id)-Number(b.id);
}
