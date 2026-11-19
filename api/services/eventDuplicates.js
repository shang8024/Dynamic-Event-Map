// Finds published events that are likely to be the same event as a draft a member is about to submit.
// The score is computed in PostgreSQL from the three signals the import job already relies on:
// title, schedule and location.
const WEIGHTS=Object.freeze({title:0.5,time:0.3,place:0.2});
const THRESHOLD=0.55; // Same time and place alone (0.5) is not enough; some title overlap is required.
const LIMIT=5,MAX_WINDOWS=20,DAY_SECONDS=86400,NEARBY_METRES=1000;
const fail=message=>{throw Object.assign(new Error(message),{status:400});};

function timestamp(value,label) {
  if(typeof value!=='string' || !Number.isFinite(Date.parse(value))) fail(`Enter a valid ${label}.`);
  return new Date(value).toISOString();
}
// Accepts the same shape as an event submission and keeps only what the comparison needs.
function prepareDraft(body) {
  if(!body || typeof body!=='object' || Array.isArray(body)) fail('Describe the event you want to check.');
  const title=typeof body.title==='string'?body.title.trim():'';
  if(title.length<3 || title.length>255) fail('Enter an event title of 3 to 255 characters.');
  const latitude=Number(body.latitude),longitude=Number(body.longitude);
  if(body.latitude==null || body.latitude==='' || body.longitude==null || body.longitude==='' ||
    !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180) fail('Choose the event location first.');
  const source=Array.isArray(body.occurrences) && body.occurrences.length?body.occurrences:[{starts_at:body.starts_at,ends_at:body.ends_at}];
  if(source.length>MAX_WINDOWS) fail(`Check at most ${MAX_WINDOWS} date ranges at a time.`);
  const windows=source.map(item=>{
    const starts_at=timestamp(item?.starts_at,'start time');
    const ends_at=item?.ends_at==null || item.ends_at===''?starts_at:timestamp(item.ends_at,'end time');
    if(Date.parse(ends_at)<Date.parse(starts_at)) fail('Each date range must end after it starts.');
    return {starts_at,ends_at};
  });
  return {title,latitude,longitude,windows};
}

// title: share of distinct words the two titles have in common (Jaccard).
// time:  1 when any scheduled occurrence overlaps a draft date range, falling to 0 when they are a day apart.
// place: 1 at the same coordinates, falling to 0 at one kilometre (haversine distance).
const SQL=`WITH draft AS (
    SELECT ARRAY(SELECT DISTINCT word FROM regexp_split_to_table(lower($1::text),'[^[:alnum:]]+') word WHERE length(word)>1) AS words
  ), windows AS (
    SELECT starts_at,ends_at FROM jsonb_to_recordset($2::jsonb) AS w(starts_at timestamptz,ends_at timestamptz)
  ), scored AS (
    SELECT e.id,e.title,e.source,e.category,e.location_name,e.location_address,schedule.starts_at,schedule.ends_at,
      title.score AS title_score,COALESCE(schedule.score,0) AS time_score,place.score AS place_score
    FROM events e CROSS JOIN draft
    CROSS JOIN LATERAL (
      SELECT ARRAY(SELECT DISTINCT word FROM regexp_split_to_table(lower(e.title),'[^[:alnum:]]+') word WHERE length(word)>1) AS words
    ) theirs
    CROSS JOIN LATERAL (
      SELECT count(*)::double precision AS total FROM unnest(draft.words) word WHERE word=ANY(theirs.words)
    ) shared
    CROSS JOIN LATERAL (
      SELECT CASE WHEN cardinality(draft.words)=0 OR cardinality(theirs.words)=0 THEN 0
        ELSE shared.total/(cardinality(draft.words)+cardinality(theirs.words)-shared.total) END AS score
    ) title
    LEFT JOIN LATERAL (
      SELECT o.starts_at,o.ends_at,GREATEST(0,1-GREATEST(0,EXTRACT(epoch FROM
        GREATEST(o.starts_at-w.ends_at,w.starts_at-COALESCE(o.ends_at,o.starts_at))))/${DAY_SECONDS}.0)::double precision AS score
      FROM event_occurrences o CROSS JOIN windows w
      WHERE o.event_id=e.id AND o.status='scheduled'
      ORDER BY score DESC,o.starts_at LIMIT 1
    ) schedule ON true
    CROSS JOIN LATERAL (
      SELECT CASE WHEN e.latitude IS NULL OR e.longitude IS NULL THEN 0 ELSE GREATEST(0,1-2*6371000*asin(LEAST(1,sqrt(
        power(sin(radians(e.latitude-$3::double precision)/2),2)+cos(radians($3::double precision))*cos(radians(e.latitude))
        *power(sin(radians(e.longitude-$4::double precision)/2),2))))/${NEARBY_METRES}.0) END AS score
    ) place
    WHERE e.archived_at IS NULL AND e.status='scheduled' AND (e.ends_at IS NULL OR e.ends_at>now())
  ), ranked AS (
    SELECT *,${WEIGHTS.title}*title_score+${WEIGHTS.time}*time_score+${WEIGHTS.place}*place_score AS score FROM scored
  )
  SELECT id,title,source,category,location_name,location_address,starts_at,ends_at,
    round(score::numeric,2)::double precision AS score,
    round(title_score::numeric,2)::double precision AS title_score,
    round(time_score::numeric,2)::double precision AS time_score,
    round(place_score::numeric,2)::double precision AS place_score
  FROM ranked WHERE score>=$5::double precision ORDER BY ranked.score DESC,id LIMIT $6::integer`;

function createEventDuplicates(pool) { return {
  async find(body,{threshold=THRESHOLD,limit=LIMIT}={}) {
    const draft=prepareDraft(body);
    const {rows}=await pool.query(SQL,[draft.title,JSON.stringify(draft.windows),draft.latitude,draft.longitude,threshold,limit]);
    return rows.map(row=>({id:row.id,title:row.title,source:row.source,category:row.category,
      location_name:row.location_name,location_address:row.location_address,starts_at:row.starts_at,ends_at:row.ends_at,
      score:row.score,signals:{title:row.title_score,time:row.time_score,place:row.place_score}}));
  },
}; }
module.exports={createEventDuplicates,prepareDraft,WEIGHTS,THRESHOLD,LIMIT};
