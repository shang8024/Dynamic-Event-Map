import {GTA_BOUNDS} from './event.js';

export const GTA_LOCATION_HELP='This map covers the Greater Toronto Area. Choose a location within the GTA; you can keep exploring the map.';

export function locationPoint(value) {
  const latitude=value?.latitude,longitude=value?.longitude;
  if(latitude==null||longitude==null||latitude===''||longitude==='') return null;
  const lat=Number(latitude),lng=Number(longitude);
  return Number.isFinite(lat)&&Number.isFinite(lng)&&Math.abs(lat)<=90&&Math.abs(lng)<=180?{lat,lng}:null;
}

export function withinGTA(point) {
  return Boolean(point&&point.lat>=GTA_BOUNDS.south&&point.lat<=GTA_BOUNDS.north&&point.lng>=GTA_BOUNDS.west&&point.lng<=GTA_BOUNDS.east);
}

export function sameLocation(a,b) {
  const coordinates=value=>value==null||value===''?'':String(Number(value));
  return (a.location_address||'').trim()===(b.location_address||'').trim()
    &&coordinates(a.latitude)===coordinates(b.latitude)&&coordinates(a.longitude)===coordinates(b.longitude);
}

export function eventLocationError(form,{existing=null,confirmed=false}={}) {
  // Do not prevent unrelated edits to imported records with incomplete locations.
  if(existing&&sameLocation(form,existing)) return '';
  const point=locationPoint(form);
  if(!point) return 'Enter valid pin coordinates, or choose a venue from the search results.';
  if(!withinGTA(point)) return GTA_LOCATION_HELP;
  if(!form.place_id&&!confirmed) return 'Confirm that this pin matches the event address, or choose a venue from the search results.';
  return '';
}

export function eventDraftSignature(form,dates) {
  return JSON.stringify({
    fields:['title','description','category','status','location_address','latitude','longitude','place_id'].map(key=>form[key]??''),
    dates:dates.map(({starts_at,ends_at})=>({starts_at,ends_at})),
  });
}
