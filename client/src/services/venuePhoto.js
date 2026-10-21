import {distanceKm} from '../utils/event.js';
// Google content stays in the open detail view, never in our database/proxy.
// Resolve only the event's venue, never an arbitrary nearby photograph.
export async function loadVenuePhoto(event,places) {
  const position=event.position;
  let placeId=event.data?.place_id;
  if(!placeId) {
    if(!event.location_address || !position) return null;
    const {places:matches}=await places.Place.searchByText({
      textQuery:`${event.location_name||''} ${event.location_address}`.trim().slice(0,2000),
      fields:['id'],locationBias:position,maxResultCount:1,
    });
    placeId=matches?.[0]?.id;
  }
  if(!placeId) return null;
  const place=new places.Place({id:placeId});
  await place.fetchFields({fields:['photos','location']});
  if(position && (!place.location || distanceKm(position,{lat:place.location.lat(),lng:place.location.lng()})>0.5)) return null;
  const photo=place.photos?.[0];
  if(!photo) return null;
  const url=photo.getURI({maxWidth:1000,maxHeight:700});
  if(!url.startsWith('https://')) return null;
  return {url,authors:photo.authorAttributions||[]};
}
