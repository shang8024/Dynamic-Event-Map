// Helpers for the "this event may already be listed" notice in the submission form.

// Builds the duplicate-check request, or returns null while the draft is too incomplete to compare.
export function duplicateDraft(form,occurrences) {
  const title=String(form?.title??'').trim();
  const missing=value=>value===''||value==null;
  if(title.length<3||missing(form.latitude)||missing(form.longitude)||!occurrences?.length) return null;
  const latitude=Number(form.latitude),longitude=Number(form.longitude);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)) return null;
  return {title,latitude,longitude,occurrences:occurrences.map(({starts_at,ends_at})=>({starts_at,ends_at:ends_at||null}))};
}

// Plain-language reasons a listed event was matched, strongest signal first.
export function matchReasons(item) {
  const {title=0,time=0,place=0}=item?.signals||{},reasons=[];
  if(title>=0.5) reasons.push('similar title');
  if(time>=0.99) reasons.push('same time'); else if(time>=0.5) reasons.push('within a day');
  if(place>=0.8) reasons.push('same place'); else if(place>0) reasons.push('nearby');
  return reasons;
}
