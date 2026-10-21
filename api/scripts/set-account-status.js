// Operator-only DB control. Never expose this as a public admin/API endpoint.
const idPattern = /^[1-9]\d{0,9}$/;
function validateArguments(profileId, action) {
  if (!idPattern.test(String(profileId)) || Number(profileId)>2147483647 || !['disable','enable','revoke'].includes(action)) {
    throw new Error('Usage: node api/scripts/set-account-status.js <profile-id> <disable|enable|revoke>');
  }
}
async function setAccountStatus(db, profileId, action) {
  validateArguments(profileId, action);
  // Enabling also advances the cutoff, so tokens issued while blocked cannot
  // silently restore access. No action grants a role or changes the Firebase UID.
  const disabled = action === 'disable' ? 'COALESCE(disabled_at,now())' : action === 'enable' ? 'NULL' : 'disabled_at';
  const {rows:[profile]} = await db.query(`UPDATE profiles SET disabled_at=${disabled},
    token_valid_after=GREATEST(COALESCE(token_valid_after,'-infinity'::timestamptz),now()),updated_at=now()
    WHERE id=$1 AND google_id IS NOT NULL RETURNING id,disabled_at,token_valid_after`,[profileId]);
  if (!profile) throw new Error('No Firebase-linked profile found for that profile ID');
  return {id:profile.id,action};
}
if (require.main === module) {
  const [profileId,action] = process.argv.slice(2);
  try {validateArguments(profileId,action);if(process.argv.length!==4) throw new Error('Expected exactly a profile ID and action');}
  catch (error) {console.error(error.message);process.exitCode=1;return;}
  const db=require('../config/db');
  setAccountStatus(db,profileId,action)
    .then(result=>console.log(`Account ${result.id}: ${result.action}. A fresh sign-in is required after enable or revoke.`))
    .catch(error=>{console.error(error.message==='No Firebase-linked profile found for that profile ID'?error.message:'Unable to update account access');process.exitCode=1;})
    .finally(()=>db.end());
}
module.exports={setAccountStatus,validateArguments};
