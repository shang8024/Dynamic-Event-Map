const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
function authenticated(user) {if(!user?.id) fail(401,'Authentication required');}
function administrator(user) {
  authenticated(user);
  if(user.role!=='admin') fail(403,'Administrator access required');
}
function activeAdministrator(profile) {return profile?.role==='admin'&&!profile.disabled_at;}
async function requireAdministrator(db,user,{lock=false}={}) {
  administrator(user);
  // Check the database, including when middleware supplied an earlier snapshot.
  // The transaction lock prevents a role/disable update racing an approval.
  const {rows:[profile]}=await db.query(`SELECT id,role,disabled_at FROM profiles WHERE id=$1${lock?' FOR NO KEY UPDATE':''}`,[user.id]);
  if(!activeAdministrator(profile)) fail(403,'Administrator access required');
}
module.exports={authenticated,administrator,activeAdministrator,requireAdministrator};
