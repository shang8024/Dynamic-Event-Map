const {sourceImage}=require('./eventImages');

// Internal bounded warm-up: no HTTP trigger, credentials stay in the API,
// and readiness never waits for external image hosts.
async function warmEventImages({db,getImage=require('./imageDelivery').getDeliveredImage,maximum=24,budgetMs=50000}={}) {
  const {rows}=await db.query(`SELECT id,data,ends_at,status FROM events WHERE archived_at IS NULL
    AND status<>'cancelled' AND (ends_at IS NULL OR ends_at>now())
    AND COALESCE(data->>'image_hidden','false')<>'true'
    AND (data->'image'->>'url' IS NOT NULL OR data->'imported_image'->>'url' IS NOT NULL)
    ORDER BY abs(latitude-43.7)+abs(longitude+79.4),id LIMIT $1`,[Math.min(24,maximum)]);
  const deadline=Date.now()+budgetMs;let cursor=0,warmed=0;
  await Promise.all([0,1].map(async()=>{while(cursor<rows.length&&Date.now()<deadline){
    const row=rows[cursor++],image=sourceImage(row);if(!image?.url)continue;
    try {await getImage(image.url,'thumb',{expiresAt:row.ends_at,revision:image.revision});warmed++;} catch {/* Optional cache priming must not affect serving. */}
  }}));
  return warmed;
}
module.exports={warmEventImages};
