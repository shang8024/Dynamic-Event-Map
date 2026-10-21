export const GTA_BOUNDS={north:44.55,south:43.3,west:-80.2,east:-78.3};
export const CATEGORIES=['Arts & Culture','Entertainment & Leisure','Education & Workshops','Sports & Fitness','Food & Drink','Business & Networking','Community & Social','Family & Kids','Technology & Innovation','Other'];
export function eventImage(event, size="detail") {
  const data=event?.data||event?._row?.data||{};
  if(isEnded(event) || event?.status==='cancelled' || event?._row?.status==='cancelled' || data.image_hidden) return null;
  const source=data.image||data.imported_image;
  if(!source?.url || !event?.id) return null;
  const tag=Array.from(source.url).reduce((hash,ch)=>Math.imul(hash^ch.charCodeAt(0),16777619)>>>0,2166136261);
  return {...source,url:`/api/events/${event.id}/image?size=${size==='thumb'?'thumb':'detail'}&v=${encodeURIComponent(`${tag}-${event.version||event._row?.version||1}`)}`};
}
export function isEnded(event,now=Date.now()) {
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
  if(event?.data?.editor_overrides?.includes('starts_at')) return event.starts_at;
  if(event?.next_start && new Date(event.next_start).getTime()>=now) return event.next_start;
  return event?.data?.occurrences?.map(item=>item.starts_at).filter(value=>new Date(value).getTime()>=now).sort()[0]||event?.starts_at;
}
export function eventTime(value) {
  if(!value || !Number.isFinite(new Date(value).getTime())) return 'Check the organizer’s schedule';
  return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Toronto',dateStyle:'medium',timeStyle:'short'}).format(new Date(value));
}
export function distanceKm(a,b) {
  if(!a||!b) return Infinity;const rad=value=>value*Math.PI/180;
  const x=Math.sin(rad(b.lat-a.lat)/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lng-a.lng)/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x));
}
export function representative(events) {
  return [...events].sort((a,b)=>Number(Boolean(eventImage(b)))-Number(Boolean(eventImage(a))) || new Date(nextStart(a))-new Date(nextStart(b)) || Number(a.id)-Number(b.id))[0];
}
