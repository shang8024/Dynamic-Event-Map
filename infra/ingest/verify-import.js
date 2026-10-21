import {FIELDS} from './normalize.js';
import {isDeepStrictEqual} from 'node:util';
const present=value=>value!==null && value!==undefined && value!=='';
function same(field,a,b) {
  if(field==='starts_at' || field==='ends_at') return (a?new Date(a).getTime():null)===(b?new Date(b).getTime():null);
  return (a??null)===(b??null);
}
export function lostSourceFields(before,event) {
  if(!before?.data?.import_snapshot || before.archived_at) return [];
  const fields=FIELDS.filter(field=>present(before.data.import_snapshot[field]) && !present(event[field]));
  for(const field of FIELDS) if(present(before.data.import_snapshot[field]) && !present(before[field])
    && !(before.data.editor_overrides||[]).includes(field)) fields.push(`existing:${field}`);
  if(before.data.imported_image?.url && !event.data.imported_image?.url) fields.push('imported_image');
  if(before.data.website && !event.data.website) fields.push('website');
  return fields;
}
export function verifyImportedRows(snapshot,beforeRows,afterRows) {
  const before=new Map(beforeRows.map(row=>[row.ref_id,row])),after=new Map(afterRows.map(row=>[row.ref_id,row]));
  const losses=[];
  for(const event of snapshot.events) {
    const previous=before.get(event.ref_id),stored=after.get(event.ref_id);
    if(!stored) {losses.push({ref_id:event.ref_id,fields:['event_row']});continue;}
    const fields=[];
    for(const field of FIELDS) {
      const overridden=previous && ((previous.data.editor_overrides||[]).includes(field)
        ||!previous.archived_at && !same(field,previous[field],previous.data.import_snapshot?.[field]));
      const expected=overridden?previous[field]:event[field];
      if(!same(field,stored[field],expected)) fields.push(field);
    }
    for(const [name,value] of Object.entries(event.data)) {
      if(['import_metadata','occurrences'].includes(name)) continue;
      if(!isDeepStrictEqual(stored.data[name]??null,value??null)) fields.push(name);
    }
    for(const name of ['provider','source_id']) if(stored.data.import_metadata?.[name]!==event.data.import_metadata?.[name]) fields.push(`import_metadata:${name}`);
    const expectedSlots=previous?.data.schedule_origin==='manual'?previous.data.occurrences:event.data.occurrences;
    if(!isDeepStrictEqual(stored.data.occurrences,expectedSlots)) fields.push('occurrences');
    if(previous && stored.user_id!==previous.user_id) fields.push('ownership');
    if(fields.length) losses.push({ref_id:event.ref_id,fields});
  }
  if(losses.length) throw Object.assign(new Error('Imported database fields differ from the validated snapshot; transaction refused'),
    {code:'INGEST_INTEGRITY',losses,provenance:snapshot.provenance});
}
export function verifyOccurrenceRows(events,rows,provenance) {
  const ranges=slots=>slots.map(item=>`${new Date(item.starts_at).getTime()}/${item.ends_at?new Date(item.ends_at).getTime():''}`).sort();
  const losses=[];
  for(const event of events) if(!isDeepStrictEqual(ranges(event.data.occurrences||[]),ranges(rows.filter(row=>row.ref_id===event.ref_id)))) {
    losses.push({ref_id:event.ref_id,fields:['event_occurrences']});
  }
  if(losses.length) throw Object.assign(new Error('Stored occurrence ranges differ from the validated event schedule; transaction refused'),
    {code:'INGEST_INTEGRITY',losses,provenance});
}
