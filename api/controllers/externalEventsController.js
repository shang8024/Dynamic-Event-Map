function getTorontoEvents(_req,res) {
  // Official listings are imported by the private scheduled job, never fetched
  // from a public request. Keep old clients from turning this into a fetch proxy.
  res.set('Cache-Control','public, max-age=3600').status(410).json({
    error:'Live source fetching is no longer available. Use /api/events for imported listings.'
  });
}
module.exports={getTorontoEvents};
