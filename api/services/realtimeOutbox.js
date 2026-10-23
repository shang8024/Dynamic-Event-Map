const {publicEvent}=require('./publicEvents');
function startRealtimeOutbox({db,io,intervalMs=1000}) {
  let running=false,stopped=false;
  async function tick() {
    if(running || stopped || (io.realtimeReady && !io.realtimeReady())) return;
    running=true;
    const client=await db.connect().catch(()=>null);
    if(!client) {running=false;return;}
    try {
      await client.query('BEGIN');
      const {rows}=await client.query('SELECT * FROM realtime_outbox WHERE published_at IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED');
      for(const row of rows) {
        const payload=row.event==='event:updated'?publicEvent(row.payload):row.payload;
        if(row.room) io.to(row.room).emit(row.event,payload);
        else io.emit(row.event,payload);
      }
      if(rows.length) await client.query('UPDATE realtime_outbox SET published_at=now() WHERE id=ANY($1::bigint[])',[rows.map(row=>row.id)]);
      await client.query('COMMIT');
    } catch(error) {
      await client.query('ROLLBACK').catch(()=>{});
      console.error('Realtime queue unavailable',error.code||error.name);
    } finally {client.release();running=false;}
  }
  const timer=setInterval(tick,intervalMs);timer.unref();void tick();
  return ()=>{stopped=true;clearInterval(timer);};
}
module.exports={startRealtimeOutbox};
