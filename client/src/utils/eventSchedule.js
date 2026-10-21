import {torontoInput,torontoInstant} from './eventDate.js';
import {eventOccurrences} from './event.js';
export function editableOccurrences(event={}) {
  const slots=eventOccurrences(event);
  return (slots.length?slots:[{starts_at:event.starts_at,ends_at:event.ends_at}]).map(item=>({
    key:item.key||item.source_row_id||crypto.randomUUID(),
    starts_at:torontoInput(item.starts_at),ends_at:torontoInput(item.ends_at),original:item,
  }));
}
export function serializeOccurrences(rows) {
  return rows.map(row=>{
    const starts_at=torontoInstant(row.starts_at,row.original?.starts_at),ends_at=torontoInstant(row.ends_at,row.original?.ends_at);
    if(!starts_at) throw new Error('Choose a start time for every occurrence.');
    if(ends_at && Date.parse(ends_at)<Date.parse(starts_at)) throw new Error('Each occurrence must end after it starts.');
    return {key:row.key,starts_at,ends_at};
  });
}
export function sameOccurrences(a,b) {
  const ranges=values=>values.map(item=>`${Date.parse(item.starts_at)}/${item.ends_at?Date.parse(item.ends_at):''}`).sort().join('|');
  return ranges(a)===ranges(b);
}
