const {randomUUID}=require('node:crypto');
const {emailHash}=require('./notificationPolicy');

async function scheduleNotifications(pool) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('eventmap:notification-schedule'))");
    await client.query('SELECT refresh_internal_occurrences()');
    // A crash after entering dispatching is ambiguous. Do not automatically send
    // again: the provider may already have accepted it before the process died.
    const uncertain=await client.query(`UPDATE notification_outbox SET status='uncertain',error_code='dispatch_interrupted',updated_at=now()
      WHERE status='dispatching' AND lease_until<now()`);
    await client.query(`UPDATE notification_outbox SET status=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,
      error_code=CASE WHEN attempts>=5 THEN 'lease_attempts_exhausted' ELSE error_code END,lease_token=NULL,lease_until=NULL,updated_at=now()
      WHERE status='leased' AND lease_until<now()`);
    const expired=await client.query(`UPDATE notification_outbox SET status='expired',error_code='delivery_window_closed',updated_at=now()
      WHERE status IN ('pending','leased') AND expires_at<=now()`);
    const reminders=await client.query(`INSERT INTO notification_outbox
      (user_id,occurrence_id,kind,delivery_key,scheduled_start,scheduled_for,expires_at)
      SELECT p.user_id,o.id,'reminder','reminder:'||p.user_id||':'||o.id||':'||extract(epoch FROM o.starts_at),o.starts_at,
        o.starts_at-make_interval(hours=>p.reminder_lead_hours),
        LEAST(o.starts_at,o.starts_at-make_interval(hours=>p.reminder_lead_hours)+interval '15 minutes')
      FROM notification_preferences p JOIN bookmarks b ON b.user_id=p.user_id
      JOIN event_occurrences o ON o.event_id=b.event_id JOIN events e ON e.id=o.event_id
      WHERE p.reminders_enabled AND p.delivery_email IS NOT NULL AND p.verified_uid IS NOT NULL
        AND e.status='scheduled' AND o.status='scheduled' AND o.starts_at>now() AND (e.ends_at IS NULL OR e.ends_at>now())
        AND (e.source='internal' OR o.source_observed_at>=now()-interval '72 hours')
        AND o.starts_at-make_interval(hours=>p.reminder_lead_hours)>now()-interval '15 minutes'
        AND o.starts_at-make_interval(hours=>p.reminder_lead_hours)<=now()+interval '24 hours'
      ON CONFLICT(delivery_key) DO UPDATE SET scheduled_for=EXCLUDED.scheduled_for,expires_at=EXCLUDED.expires_at,updated_at=now()
      WHERE notification_outbox.status='pending' AND notification_outbox.scheduled_for IS DISTINCT FROM EXCLUDED.scheduled_for`);
    const marketing=await client.query(`WITH weekly AS (
      SELECT (date_trunc('week',now() AT TIME ZONE 'America/Toronto')+interval '9 hours') AT TIME ZONE 'America/Toronto' AS send_at
    ) INSERT INTO notification_outbox(user_id,kind,delivery_key,scheduled_for,expires_at)
      SELECT user_id,'marketing','marketing:'||user_id||':'||to_char(send_at AT TIME ZONE 'America/Toronto','YYYY-MM-DD'),send_at,send_at+interval '12 hours'
      FROM notification_preferences CROSS JOIN weekly WHERE marketing_enabled AND delivery_email IS NOT NULL AND verified_uid IS NOT NULL
        AND now()>=send_at AND now()<send_at+interval '12 hours'
      ON CONFLICT(delivery_key) DO NOTHING`);
    const cancelled=await client.query(`UPDATE notification_outbox q SET status='cancelled',error_code='eligibility_changed',updated_at=now()
      WHERE q.status IN ('pending','leased') AND (NOT EXISTS (
        SELECT 1 FROM notification_preferences p WHERE p.user_id=q.user_id AND
          ((q.kind='reminder' AND p.reminders_enabled) OR (q.kind='marketing' AND p.marketing_enabled)))
        OR (q.kind='reminder' AND NOT EXISTS (
          SELECT 1 FROM event_occurrences o JOIN events e ON e.id=o.event_id
          JOIN bookmarks b ON b.event_id=e.id AND b.user_id=q.user_id
          WHERE o.id=q.occurrence_id AND e.status='scheduled' AND o.status='scheduled' AND o.starts_at=q.scheduled_start
            AND o.starts_at>now() AND (e.ends_at IS NULL OR e.ends_at>now())
            AND (e.source='internal' OR o.source_observed_at>=now()-interval '72 hours'))))`);
    await client.query('COMMIT');
    return {reminders:reminders.rowCount,marketing:marketing.rowCount,cancelled:cancelled.rowCount,expired:expired.rowCount,uncertain:uncertain.rowCount};
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function claimNext(pool,{marketingEnabled=false}={}) {
  const lease=randomUUID();
  const {rows}=await pool.query(`WITH next AS (SELECT id FROM notification_outbox
    WHERE status='pending' AND scheduled_for<=now() AND available_at<=now() AND expires_at>now()
      AND attempts<5 AND (kind='reminder' OR $2::boolean)
    ORDER BY scheduled_for,id FOR UPDATE SKIP LOCKED LIMIT 1)
    UPDATE notification_outbox q SET status='leased',lease_token=$1,lease_until=now()+interval '2 minutes',attempts=attempts+1,updated_at=now()
      FROM next WHERE q.id=next.id RETURNING q.*`,[lease,marketingEnabled]);
  return rows[0];
}

async function inspectJob(client,job) {
  const {rows:[row]}=await client.query(`SELECT q.*,p.reminders_enabled,p.marketing_enabled,p.delivery_email,p.verified_uid,
      p.reminder_lead_hours,o.status occurrence_status,o.starts_at occurrence_start,o.source_observed_at,
      e.id event_id,e.title,e.source,e.status event_status,e.starts_at event_start,e.ends_at event_end,e.location_name,e.location_address,
      e.data->'import_snapshot'->>'starts_at' imported_start,e.data->'import_snapshot'->>'ends_at' imported_end,
      EXISTS(SELECT 1 FROM bookmarks b WHERE b.user_id=q.user_id AND b.event_id=e.id) bookmarked
    FROM notification_outbox q JOIN notification_preferences p ON p.user_id=q.user_id
    LEFT JOIN event_occurrences o ON o.id=q.occurrence_id LEFT JOIN events e ON e.id=o.event_id WHERE q.id=$1`,[job.id]);
  return row;
}
function eligibility(row,now=Date.now()) {
  if (!row || !row.delivery_email || !row.verified_uid) return 'missing_verified_recipient';
  if (new Date(row.expires_at).getTime()<=now) return 'delivery_window_closed';
  if (row.kind==='marketing') return row.marketing_enabled ? null : 'marketing_opted_out';
  if (!row.reminders_enabled || !row.bookmarked) return 'reminder_opted_out';
  if (row.event_status==='cancelled') return 'event_cancelled';
  if (row.occurrence_status!=='scheduled' || +new Date(row.occurrence_start)!==+new Date(row.scheduled_start)) return 'occurrence_changed';
  if (+new Date(row.occurrence_start)<=now || (row.event_end && +new Date(row.event_end)<=now)) return 'event_ended';
  if (+new Date(row.scheduled_for)!==+new Date(row.occurrence_start)-row.reminder_lead_hours*3600000) return 'lead_time_changed';
  if (row.source==='external') {
    if (!row.source_observed_at || +new Date(row.source_observed_at)<now-72*3600000) return 'stale_source';
    if (+new Date(row.event_start)!==+new Date(row.imported_start) ||
        (row.event_end ? +new Date(row.event_end) : null)!==(row.imported_end ? +new Date(row.imported_end) : null)) return 'schedule_needs_review';
  } else if (+new Date(row.event_start)!==+new Date(row.occurrence_start)) return 'occurrence_changed';
  return null;
}

async function beginDispatch(pool,job,verifiedIdentity) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize the final send boundary with preference/unsubscribe changes.
    await client.query('SELECT user_id FROM notification_preferences WHERE user_id=$1 FOR UPDATE',[job.user_id]);
    const {rows:[lease]}=await client.query(`SELECT status,lease_token,lease_until FROM notification_outbox WHERE id=$1 FOR UPDATE`,[job.id]);
    if (lease?.status!=='leased' || lease.lease_token!==job.lease_token || +new Date(lease.lease_until)<=Date.now()) {
      await client.query('ROLLBACK'); return null;
    }
    const row=await inspectJob(client,job);
    let reason=eligibility(row);
    if (!verifiedIdentity || verifiedIdentity.disabled || !verifiedIdentity.emailVerified || verifiedIdentity.uid!==row?.verified_uid ||
      verifiedIdentity.email?.toLowerCase()!==row?.delivery_email?.toLowerCase()) reason='identity_changed';
    if (!reason) {
      const suppressed=await client.query('SELECT 1 FROM email_suppressions WHERE email_hash=$1',[emailHash(row.delivery_email)]);
      if (suppressed.rowCount) reason='recipient_suppressed';
    }
    await client.query(`UPDATE notification_outbox SET status=$3,error_code=$4,updated_at=now() WHERE id=$1 AND lease_token=$2`,
      [job.id,job.lease_token,reason?'cancelled':'dispatching',reason]);
    await client.query('COMMIT');
    return reason ? null : row;
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function finishDispatch(pool,job,result) {
  await pool.query(`UPDATE notification_outbox SET status=$3,provider_message_id=$4,error_code=$5,
    lease_until=NULL,updated_at=now(),available_at=now()+make_interval(secs=>LEAST(3600,30*power(2,attempts)::int))
    WHERE id=$1 AND lease_token=$2 AND status IN ('leased','dispatching')`,
  [job.id,job.lease_token,result.status,result.messageId || null,result.code || null]);
}
module.exports={scheduleNotifications,claimNext,inspectJob,eligibility,beginDispatch,finishDispatch};
