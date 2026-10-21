const policy = require('./notificationPolicy');

async function readPreferences(pool,userId) {
  const result=await pool.query('SELECT * FROM notification_preferences WHERE user_id=$1',[userId]);
  return { preferences:policy.publicPreferences(result.rows[0]),delivery:policy.deliveryState() };
}

async function savePreferences(pool,userId,changes,identity,{source='settings'}={}) {
  const client=await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO notification_preferences(user_id) VALUES($1) ON CONFLICT DO NOTHING',[userId]);
    const {rows:[before]}=await client.query('SELECT * FROM notification_preferences WHERE user_id=$1 FOR UPDATE',[userId]);
    const next={...policy.publicPreferences(before),...changes};
    const email=identity?.email ?? before.delivery_email;
    const uid=identity?.uid ?? before.verified_uid;
    await client.query(`UPDATE notification_preferences SET reminders_enabled=$2,marketing_enabled=$3,
      personalization_enabled=$4,reminder_lead_hours=$5,delivery_email=$6,verified_uid=$7,consent_version=$8,updated_at=now() WHERE user_id=$1`,
    [userId,next.reminders_enabled,next.marketing_enabled,next.personalization_enabled,next.reminder_lead_hours,email,uid,policy.CONSENT_VERSION]);
    for (const purpose of ['reminders','marketing','personalization']) {
      const key=`${purpose}_enabled`;
      if (before[key]!==next[key]) await client.query(`INSERT INTO consent_events(user_id,purpose,enabled,source,policy_version) VALUES($1,$2,$3,$4,$5)`,
        [userId,purpose,next[key],source,policy.CONSENT_VERSION]);
    }
    // Dispatching rows have crossed the send boundary; the worker serializes
    // that boundary with this preference lock and never retries ambiguous mail.
    await client.query(`UPDATE notification_outbox SET status='cancelled',error_code='preference_changed',updated_at=now()
      WHERE user_id=$1 AND status IN ('pending','leased') AND
      ((kind='reminder' AND NOT $2::boolean) OR (kind='marketing' AND NOT $3::boolean))`,[userId,next.reminders_enabled,next.marketing_enabled]);
    await client.query('COMMIT');
    return {preferences:next,delivery:policy.deliveryState()};
  } catch(error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
module.exports={readPreferences,savePreferences};
