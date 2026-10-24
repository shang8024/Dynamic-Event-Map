const test=require('node:test'),assert=require('node:assert/strict');
const {createMapCatalogue}=require('../services/mapCatalogue');
function response(){return {headers:{},statusCode:200,set(key,value){this.headers[key]=value;return this;},status(value){this.statusCode=value;return this;},type(){return this;},send(body){this.body=body;return this;},json(body){this.body=body;return this;},end(){return this;}};}
test('map snapshots coalesce, conditionally return 304, invalidate on revision/time and bound search input',async()=>{
  let reads=0,revision=1,clock=0;
  const model={getMapRevision:async()=>({rows:[{version:revision}]}),getMap:async query=>{reads++;assert.equal(query,'library');return {rows:[{id:1,title:'Library',data:{import_snapshot:{secret:1}},next_occurrence:{starts_at:'2027-01-01T12:00:00Z'}}]};}};
  const catalogue=createMapCatalogue(model,{now:()=>clock}),request=etag=>({query:{q:' Library '},get:()=>etag});
  const a=response(),b=response();await Promise.all([catalogue(request(),a),catalogue(request(),b)]);assert.equal(reads,1);
  assert.ok(JSON.parse(a.body)[0]._summary);assert.ok(!a.body.includes('secret'));
  const unchanged=response();await catalogue(request(a.headers.ETag),unchanged);assert.equal(unchanged.statusCode,304);assert.equal(reads,1);
  clock=16000;await catalogue(request(),response());assert.equal(reads,2);
  revision++;await catalogue(request(),response());assert.equal(reads,3);
  const bad=response();await catalogue({query:{q:'x'.repeat(201)}},bad);assert.equal(bad.statusCode,400);assert.equal(reads,3);
});
test('real database map projection matches full catalogue and searches descriptions without exposing them',
  {skip:process.env.NOTIFICATION_DB_TEST!=='1'},async()=>{
  assert.equal(process.env.PGHOST,'127.0.0.1');assert.ok(['55432','55433'].includes(process.env.PGPORT));
  const {Pool}=require('pg'),fs=require('node:fs/promises'),path=require('node:path');
  const schema=`map_catalogue_test_${process.pid}`,admin=new Pool({max:1}),pool=new Pool({options:`-c search_path=${schema}`});
  await admin.query(`CREATE SCHEMA ${schema}`);
  try {
    await pool.query(await fs.readFile(path.resolve(__dirname,'../../db/init.sql'),'utf8'));
    for(const file of (await fs.readdir(path.resolve(__dirname,'../../db/migrations'))).filter(name=>/^\d.*\.sql$/.test(name)).sort())
      await pool.query(await fs.readFile(path.resolve(__dirname,'../../db/migrations',file),'utf8'));
    const {createEventModel}=require('../models/eventModel'),model=createEventModel(pool);
    const owner=(await pool.query("INSERT INTO profiles(username) VALUES('map-owner') RETURNING id")).rows[0];
    const starts_at=new Date(Date.now()+86400000).toISOString(),ends_at=new Date(Date.now()+90000000).toISOString();
    await model.create({user_id:owner.id,title:'Title search',description:'Description-only needle',category:'Other',lat:43.7,lng:-79.4,location_address:'Toronto',occurrences:[{starts_at,ends_at}]});
    await pool.query("INSERT INTO events(user_id,title,description,source) VALUES($1,'Unknown date','Other description','internal')",[owner.id]);
    const full=(await model.getAll()).rows,map=(await model.getMap()).rows;
    assert.deepEqual(map.map(row=>row.id),full.map(row=>row.id));
    assert.ok(map.every(row=>!Object.hasOwn(row,'description')&&!Object.hasOwn(row,'occurrences')));
    assert.equal(map.length,2);assert.equal(Date.parse(map[0].next_occurrence.starts_at),Date.parse(starts_at));assert.equal(map[1].next_occurrence,null);
    const word=full.find(row=>row.description)?.description.match(/[a-z]{5,}/i)?.[0]?.toLowerCase()||'library';
    const expected=full.filter(row=>(row.title+' '+(row.description||'')).toLowerCase().includes(word)).map(row=>row.id);
    assert.deepEqual((await model.getMap(word)).rows.map(row=>row.id),expected);
    assert.deepEqual((await model.getMap('%_not-a-wildcard')).rows,[]);
  } finally {await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await require('../config/db').end();}
});
