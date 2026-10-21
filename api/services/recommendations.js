async function recommendations(pool,userId,limit=12) {
  const {rows:[preference]}=await pool.query('SELECT personalization_enabled FROM notification_preferences WHERE user_id=$1',[userId]);
  const personalized=preference?.personalization_enabled === true;
  const {rows}=await pool.query(`WITH interests AS (
    SELECT e.category,SUM(exp(-greatest(0,extract(epoch FROM (now()-b.created_at)))/7776000.0)) score
    FROM bookmarks b JOIN events e ON e.id=b.event_id WHERE b.user_id=$1 GROUP BY e.category
  ), candidates AS (
    SELECT e.id,e.title,e.category,e.data,e.status,e.version,e.ends_at,e.location_name,e.location_address,e.latitude,e.longitude,
      COALESCE(o.starts_at,CASE WHEN e.source='internal' THEN e.starts_at END) starts_at,
      CASE WHEN $2::boolean THEN COALESCE(i.score,0) ELSE 0 END score
    FROM events e LEFT JOIN interests i ON i.category=e.category
    LEFT JOIN LATERAL (SELECT min(starts_at) starts_at FROM event_occurrences o
      WHERE o.event_id=e.id AND o.status='scheduled' AND o.starts_at>now()
        AND (e.source='internal' OR e.data->>'schedule_origin'='manual' OR o.source_observed_at>=now()-interval '72 hours')) o ON true
    WHERE e.status='scheduled' AND NOT EXISTS (SELECT 1 FROM bookmarks b WHERE b.user_id=$1 AND b.event_id=e.id)
      AND (e.ends_at IS NULL OR e.ends_at>now()) AND e.latitude IS NOT NULL AND e.longitude IS NOT NULL
  ) SELECT * FROM candidates WHERE starts_at>now() ORDER BY score DESC,starts_at,id LIMIT $3`,[userId,personalized,limit]);
  return {personalized,events:rows.map(({score,...event})=>({...event,reason:personalized && Number(score)>0
    ? `Because you saved ${event.category.toLowerCase()} events` : 'Upcoming in Toronto'}))};
}
module.exports={recommendations};
