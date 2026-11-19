const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {Pool}=require('pg');
const {createEventModel}=require('../models/eventModel');
const {createEventDuplicates}=require('../services/eventDuplicates');

test('PostgreSQL ranks likely duplicates by title, schedule and distance and hides unavailable events',
  {skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');
  const schema=`duplicates_test_${process.pid}`,admin=new Pool({max:1}),db=new Pool({options:`-c search_path=${schema}`});
  const at=hours=>new Date(Date.now()+hours*3600000).toISOString();
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await db.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    for(const file of (await fs.readdir(path.resolve(__dirname,'../../db/migrations'))).filter(file=>/^[0-9].*[.]sql$/.test(file)).sort()) {
      await db.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations',file),'utf8'));
    }
    const {rows:[owner]}=await db.query("INSERT INTO profiles(username,role) VALUES('owner','admin') RETURNING id");
    const model=createEventModel(db),duplicates=createEventDuplicates(db),hall={lat:43.6534,lng:-79.3841,location_address:'100 Queen St W, Toronto'};
    const add=async(title,hours,place=hall,occurrences=null)=>(await model.create({user_id:owner.id,title,description:'Fixture',category:'Music',...place,
      occurrences:occurrences||[{key:'only',starts_at:at(hours),ends_at:at(hours+2)}]})).rows[0];
    const same=await add('Jazz in the Park',48);
    const longer=await add('Jazz in the Park: Evening Session',48);
    await add('Harbourfront Food Festival',48);
    const later=await add('Jazz in the Park',288);
    const cancelled=await add('Jazz in the Park',48);
    await model.update({id:cancelled.id,actor_id:owner.id,status:'cancelled'});
    const elsewhere=await add('Jazz in the Park',48,{lat:43.7735,lng:-79.2577,location_address:'Scarborough'});
    const series=await add('Winter Lights Walk',600,hall,[{key:'first',starts_at:at(600),ends_at:at(602)},{key:'second',starts_at:at(648),ends_at:at(650)}]);

    const draft={title:'jazz in the PARK!',latitude:hall.lat,longitude:hall.lng,occurrences:[{starts_at:at(48.5),ends_at:at(49)}]};
    const found=await duplicates.find(draft);
    // Same title and time at a distant pin still ranks above the same title and place on another day.
    assert.deepEqual(found.map(item=>item.id),[same.id,longer.id,elsewhere.id,later.id]);
    assert.deepEqual(found[0].signals,{title:1,time:1,place:1});
    assert.equal(found[0].score,1);
    assert.equal(found[1].signals.title,0.67);
    assert.deepEqual([found[2].signals,found[2].score],[{title:1,time:1,place:0},0.8]);
    assert.deepEqual([found[3].signals.time,found[3].score],[0,0.7]);
    assert.equal(Date.parse(found[0].starts_at),Date.parse(same.starts_at));

    // A draft with several date ranges matches on whichever range is closest to a listed occurrence.
    const repeated=await duplicates.find({...draft,occurrences:[{starts_at:at(100),ends_at:at(101)},{starts_at:at(288.5),ends_at:null}]});
    assert.deepEqual([repeated[0].id,repeated[0].score],[later.id,1]);
    // A listed series matches on its second occurrence, and the matched occurrence is the one returned.
    const [walk]=await duplicates.find({title:'Winter Lights Walk',latitude:hall.lat,longitude:hall.lng,starts_at:at(649)});
    assert.deepEqual([walk.id,walk.signals.time],[series.id,1]);
    // Occurrence rows are stored to the second, so compare at that precision.
    assert.equal(Math.floor(Date.parse(walk.starts_at)/1000),Math.floor(Date.parse(series.occurrences[1].starts_at)/1000));
    // The same title on another day in another part of the city is not reported.
    assert.deepEqual(await duplicates.find({title:'Jazz in the Park',latitude:43.59,longitude:-79.64,starts_at:at(2000)}),[]);
    assert.equal((await duplicates.find(draft,{limit:1})).length,1);
  } finally {await db.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
