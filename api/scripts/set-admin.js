// Run on a trusted operator machine with a read-only Firebase identity credential
// and a database connection. Identity is verified before any role is granted.
const admin = require('../config/firebaseAdmin');
const pool = require('../config/db');
const auth = require('../middleware/auth');

async function main() {
  const email = process.argv[2];
  if (!email || process.argv.length !== 3) throw new Error('Usage: node scripts/set-admin.js <verified-email>');
  const identity = await admin.auth().getUserByEmail(email);
  if (!identity.emailVerified || identity.disabled) throw new Error('An enabled, verified Firebase account is required');
  const profile = await auth.provisionProfile({ uid:identity.uid, email:identity.email, name:identity.displayName, picture:identity.photoURL });
  await pool.query("UPDATE profiles SET role='admin',updated_at=now() WHERE id=$1 AND google_id=$2", [profile.id,identity.uid]);
  console.log('Administrator role granted to the verified Firebase identity. Sign in again to refresh the application role.');
}
main().catch(error => { console.error(error.code || error.message); process.exitCode=1; })
  .finally(async()=>{ await pool.end(); await require('../config/sequelize').close(); await require('../config/redis').quit(); });
