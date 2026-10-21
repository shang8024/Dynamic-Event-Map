const {randomUUID}=require('node:crypto');
function normalizeOccurrences(value) {
  const fail=message=>{throw Object.assign(new Error(message),{status:400});};
  if(!Array.isArray(value) || value.length<1 || value.length>366) fail('Add between 1 and 366 event occurrences.');
  const keys=new Set(),ranges=new Set();
  return value.map(item=>{
    if(!item || typeof item!=='object') fail('Invalid event occurrence.');
    const key=item.key ?? randomUUID();
    if(typeof key!=='string' || !/^[A-Za-z0-9:._-]{1,100}$/.test(key) || keys.has(key)) fail('Invalid or duplicate occurrence identity.');
    keys.add(key);
    function instant(value,optional=false) {
      if(optional && (value==null || value==='')) return null;
      const date=typeof value==='string' && /^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
      if(!date || +date[2]<1 || +date[2]>12 || +date[3]<1 || +date[3]>new Date(Date.UTC(+date[1],+date[2],0)).getUTCDate()
        || !Number.isFinite(Date.parse(value))) fail('Occurrence dates must include a valid timezone.');
      return new Date(value).toISOString();
    }
    const starts_at=instant(item.starts_at),ends_at=instant(item.ends_at,true);
    if(ends_at && ends_at<starts_at) fail('An occurrence must end after it starts.');
    const range=`${starts_at}/${ends_at}`;if(ranges.has(range)) fail('Remove duplicate event occurrences.');ranges.add(range);
    return {key,starts_at,ends_at};
  }).sort((a,b)=>a.starts_at.localeCompare(b.starts_at));
}
function prepareEventInput(input) {
  if(!Object.hasOwn(input,'occurrences')) return input;
  const occurrences=normalizeOccurrences(input.occurrences);
  return {...input,occurrences,starts_at:occurrences[0].starts_at,
    ends_at:occurrences.every(item=>item.ends_at)?occurrences.map(item=>item.ends_at).sort().at(-1):null};
}
module.exports={normalizeOccurrences,prepareEventInput};
