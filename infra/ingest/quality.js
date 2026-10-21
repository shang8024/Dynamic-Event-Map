import {createHash} from 'node:crypto';
import {sourceRevision} from './source-state.js';
import {lostSourceFields} from './verify-import.js';
export function assessQuality(candidates,known,{ratio=0.1,minimum=3}={}) {
  if(!Number.isFinite(ratio) || ratio<=0 || ratio>1 || !Number.isInteger(minimum) || minimum<1) throw new Error('Invalid ingestion alert thresholds');
  const fresh=candidates.filter(item=>!known.has(item.ref_id));
  const freshErrors=fresh.filter(item=>item.issue).length,totalErrors=candidates.filter(item=>item.issue).length;
  return {new_events:fresh.length,new_errors:freshErrors,new_ratio:fresh.length?freshErrors/fresh.length:0,
    total_events:candidates.length,total_errors:totalErrors,total_ratio:candidates.length?totalErrors/candidates.length:0,
    threshold:ratio,minimum,blocked:(freshErrors>=minimum && freshErrors/fresh.length>=ratio)
      ||(totalErrors>=minimum && totalErrors/candidates.length>=ratio)};
}
export async function enforceImportQuality(client,snapshot) {
  const candidates=snapshot.review?.candidates;
  if(!candidates) return;
  const known=await client.query("SELECT * FROM events WHERE source='external' AND ref_id=ANY($1::text[])",[candidates.map(item=>item.ref_id)]);
  const old=new Map(known.rows.map(item=>[item.ref_id,item])),events=new Map(snapshot.events.map(item=>[item.ref_id,item]));
  const reviewed=candidates.map(item=>{
    const missing_fields=[...new Set([...(item.missing_fields||[]),...(events.has(item.ref_id)
      ?lostSourceFields(old.get(item.ref_id),events.get(item.ref_id)):[])])]
      .filter(field=>!item.known_exclusions?.includes(field));
    return {...item,missing_fields,issue:item.issue||missing_fields.length>0};
  });
  const quality=assessQuality(reviewed,new Set(old.keys()),{
    ratio:Number(process.env.INGEST_ERROR_RATIO||0.1),minimum:Number(process.env.INGEST_ERROR_MINIMUM||3)});
  if(quality.blocked) throw Object.assign(new Error('Official event data quality error ratio exceeded the review threshold; import refused'),
    {code:'INGEST_QUALITY',quality,anomalies:reviewed.filter(item=>item.issue).slice(0,20)
      .map(item=>({ref_id:item.ref_id,fields:item.missing_fields})),provenance:snapshot.provenance});
  return quality;
}
export async function recordIngestAlert(client,error,fallbackRevision='unknown') {
  const code=['INGEST_QUALITY','INGEST_INTEGRITY'].includes(error.code)?error.code:'INGEST_FAILED';
  const revision=sourceRevision(error.provenance)||fallbackRevision;
  const key=createHash('sha256').update(`${code}:${revision}`).digest('hex');
  // Operational details contain counts and controlled codes, never raw rows,
  // organizer contacts, SQL errors or credentials.
  const details={revision,...(error.quality?{quality:error.quality,anomalies:error.anomalies||[]}:error.losses?{field_losses:error.losses}:{reason:'Source retrieval, validation or schema check failed. Review the job journal.'})};
  const affected=[...new Set((error.anomalies||[]).flatMap(item=>item.fields))];
  const message=error.quality?`Import paused: ${error.quality.new_errors}/${error.quality.new_events} new events and ${error.quality.total_errors}/${error.quality.total_events} total events have data quality problems.${affected.length?` Affected fields: ${affected.join(', ')}.`:''} Existing listings were not replaced. Review the Toronto source format.`
    :error.losses?`Import rolled back: ${error.losses.length} events failed database integrity checks. Affected fields: ${[...new Set(error.losses.flatMap(item=>item.fields))].join(', ')}. Review the import before retrying.`
    :'Toronto event ingestion failed. Existing listings were not replaced. Review the source format and job journal.';
  await client.query('BEGIN');
  try {
    const {rows:[alert]}=await client.query(`INSERT INTO ingest_alerts(dedup_key,code,details) VALUES($1,$2,$3::jsonb)
      ON CONFLICT(dedup_key) DO UPDATE SET last_seen_at=now(),repetitions=ingest_alerts.repetitions+1
      RETURNING id,(xmax=0) inserted`,[key,code,JSON.stringify(details)]);
    if(alert.inserted) {
      const recipients=await client.query(`INSERT INTO in_app_notifications(user_id,kind,title,message,activity_key)
        SELECT id,'ingest_alert','Toronto import needs review',$1,$2 FROM profiles WHERE role='admin'
        ON CONFLICT(user_id,activity_key) DO NOTHING RETURNING id,user_id`,[message,`ingest:${alert.id}`]);
      for(const recipient of recipients.rows) await client.query(`INSERT INTO realtime_outbox(room,event,payload)
        VALUES($1,'notification:changed',$2::jsonb)`,[`user_${recipient.user_id}`,JSON.stringify({id:recipient.id})]);
    }
    await client.query('COMMIT');return {id:alert.id,new:alert.inserted};
  } catch(failure) {await client.query('ROLLBACK');throw failure;}
}
